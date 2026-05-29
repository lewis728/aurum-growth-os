/**
 * src/lib/services/metaAuthService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Manages Meta OAuth tokens for tenant ad account connections.
 *
 * Security contract:
 *   - Tokens are ALWAYS encrypted at rest using AES-256-CBC.
 *   - Decrypted tokens are NEVER returned to the client via any API response.
 *   - All Meta API calls must call getMetaAccessToken(tenantId) — never use
 *     process.env.META_ACCESS_TOKEN for tenant operations.
 *
 * Environment variables required:
 *   META_APP_ID             — Meta App ID from Meta Developer Portal
 *   META_APP_SECRET         — Meta App Secret (server-only, never expose)
 *   META_TOKEN_ENCRYPTION_KEY — 32-character string for AES-256-CBC key derivation
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// ── Constants ─────────────────────────────────────────────────────────────────

const META_GRAPH_API_BASE = "https://graph.facebook.com/v19.0";
const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;     // AES block size
const KEY_LENGTH = 32;    // AES-256 requires 32 bytes

// ── Environment Guards ────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const raw = process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("META_TOKEN_ENCRYPTION_KEY is not configured");
  // Derive a consistent 32-byte key via SHA-256 hash of the raw string.
  // This allows the env var to be any length while always producing a valid AES-256 key.
  return crypto.createHash("sha256").update(raw).digest().subarray(0, KEY_LENGTH);
}

function getMetaAppId(): string {
  const id = process.env.META_APP_ID;
  if (!id) throw new Error("META_APP_ID is not configured");
  return id;
}

function getMetaAppSecret(): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET is not configured");
  return secret;
}

// ── Token Encryption ──────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext access token using AES-256-CBC.
 * Returns a hex string in the format: <iv_hex>:<ciphertext_hex>
 *
 * The IV is randomly generated per encryption call, ensuring that encrypting
 * the same token twice produces different ciphertext (semantic security).
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a token previously encrypted by encryptToken().
 * Expects format: <iv_hex>:<ciphertext_hex>
 *
 * Throws if the format is invalid or decryption fails.
 */
export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 2) {
    throw new Error("Invalid encrypted token format — expected <iv>:<ciphertext>");
  }
  const [ivHex, ciphertextHex] = parts as [string, string];
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// ── Token Retrieval ───────────────────────────────────────────────────────────

/**
 * Fetches the decrypted Meta access token for a given tenant.
 *
 * Throws if:
 *   - No MetaConnection row exists for the tenant (not connected)
 *   - The token has expired (tokenExpiresAt < now)
 *
 * The decrypted token must NEVER be returned to the client.
 * Use it only for server-side Meta Graph API calls.
 */
export async function getMetaAccessToken(tenantId: string): Promise<string> {
  const connection = await prisma.metaConnection.findUnique({
    where: { tenantId },
  });

  if (!connection) {
    throw new Error(
      `No Meta account connected for tenant ${tenantId}. ` +
      "The tenant must complete the Meta OAuth flow before running campaigns."
    );
  }

  if (connection.tokenExpiresAt < new Date()) {
    throw new Error(
      `Meta access token for tenant ${tenantId} has expired ` +
      `(expired at ${connection.tokenExpiresAt.toISOString()}). ` +
      "The tenant must reconnect their Meta account."
    );
  }

  return decryptToken(connection.encryptedAccessToken);
}

// ── Token Refresh ─────────────────────────────────────────────────────────────

/**
 * Exchanges the tenant's current token for a new 60-day long-lived token
 * via the Meta Graph API token exchange endpoint.
 *
 * Meta long-lived tokens are valid for ~60 days.
 * This should be called proactively (e.g. when < 7 days remain) to avoid
 * service interruption.
 *
 * Updates the MetaConnection row with the new encrypted token and expiry.
 */
export async function refreshMetaToken(tenantId: string): Promise<void> {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();

  // Fetch the current (possibly expiring) token
  const currentToken = await getMetaAccessToken(tenantId);

  // Exchange for a long-lived token
  const url = new URL(`${META_GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", currentToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Meta token refresh failed (HTTP ${res.status}): ${body}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Meta token refresh response missing access_token");
  }

  // Long-lived tokens expire in ~60 days. Use the returned expires_in if
  // present, otherwise default to 59 days (conservative).
  const expiresInSeconds = data.expires_in ?? 59 * 24 * 60 * 60;
  const tokenExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await prisma.metaConnection.update({
    where: { tenantId },
    data: {
      encryptedAccessToken: encryptToken(data.access_token),
      tokenExpiresAt,
      updatedAt: new Date(),
    },
  });
}

// ── Connection Validation ─────────────────────────────────────────────────────

/**
 * Tests whether the tenant's stored Meta token is valid by making a lightweight
 * call to GET /me?fields=id,name against the Graph API.
 *
 * Returns:
 *   true  — token is valid and Meta API is reachable
 *   false — token is expired, revoked, or the tenant has no connection
 *
 * Never throws — designed to be used in UI status checks.
 */
export async function validateMetaConnection(tenantId: string): Promise<boolean> {
  let token: string;
  try {
    token = await getMetaAccessToken(tenantId);
  } catch {
    // Not connected or token expired
    return false;
  }

  try {
    const url = new URL(`${META_GRAPH_API_BASE}/me`);
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", token);

    const res = await fetch(url.toString());
    if (!res.ok) return false;

    const data = (await res.json()) as { id?: string; error?: unknown };
    return typeof data.id === "string" && data.id.length > 0;
  } catch {
    return false;
  }
}

// ── Connection Status ─────────────────────────────────────────────────────────

export type MetaConnectionStatus =
  | { connected: false; reason: "not_connected" }
  | { connected: false; reason: "expired"; expiredAt: Date }
  | {
      connected: true;
      adAccountId: string;
      pageId: string;
      pixelId: string;
      instagramActorId: string | null;
      tokenExpiresAt: Date;
      connectedAt: Date;
    };

/**
 * Returns a typed status object for the tenant's Meta connection.
 * Safe to call from API routes that return status to the frontend —
 * the decrypted token is NEVER included in the return value.
 */
export async function getMetaConnectionStatus(
  tenantId: string
): Promise<MetaConnectionStatus> {
  const connection = await prisma.metaConnection.findUnique({
    where: { tenantId },
  });

  if (!connection) {
    return { connected: false, reason: "not_connected" };
  }

  if (connection.tokenExpiresAt < new Date()) {
    return {
      connected: false,
      reason: "expired",
      expiredAt: connection.tokenExpiresAt,
    };
  }

  return {
    connected: true,
    adAccountId: connection.adAccountId,
    pageId: connection.pageId,
    pixelId: connection.pixelId,
    instagramActorId: connection.instagramActorId,
    tokenExpiresAt: connection.tokenExpiresAt,
    connectedAt: connection.connectedAt,
  };
}
