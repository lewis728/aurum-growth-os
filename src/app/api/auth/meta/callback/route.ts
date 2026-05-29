/**
 * src/app/api/auth/meta/callback/route.ts
 * GET /api/auth/meta/callback
 *
 * Handles the Meta OAuth callback after the user grants permissions.
 *
 * Flow:
 *   1. Validate the CSRF state token (HMAC signature + max-age check).
 *   2. Exchange the authorization code for a short-lived access token.
 *   3. Exchange the short-lived token for a 60-day long-lived token.
 *   4. Fetch the tenant's ad account ID, Facebook Page ID, and Pixel ID.
 *   5. Encrypt the long-lived token and upsert into MetaConnection table.
 *   6. Redirect to the dashboard with ?meta_connected=true.
 *
 * On any error, redirects to the dashboard with ?meta_error=<reason>.
 * The decrypted token is NEVER returned to the client.
 *
 * Required environment variables:
 *   META_APP_ID                — Meta App ID
 *   META_APP_SECRET            — Meta App Secret (server-only)
 *   META_TOKEN_ENCRYPTION_KEY  — 32-char AES-256 key
 *   CLERK_SECRET_KEY           — Used to verify the CSRF state signature
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/services/metaAuthService";

const META_GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

// ── State token max age: 10 minutes ──────────────────────────────────────────
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ── Environment Guards ────────────────────────────────────────────────────────

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

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not configured");
  return key;
}

// ── CSRF State Validation ─────────────────────────────────────────────────────

interface StatePayload {
  tenantId: string;
  issuedAt: string;
  signature: string;
}

/**
 * Verifies the CSRF state token produced by the initiation route.
 * Returns the tenantId if valid, throws on any validation failure.
 */
function verifyStateToken(state: string): string {
  const key = getClerkSecretKey();

  let payload: StatePayload;
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    payload = JSON.parse(decoded) as StatePayload;
  } catch {
    throw new Error("State token is not valid base64url JSON");
  }

  const { tenantId, issuedAt, signature } = payload;
  if (!tenantId || !issuedAt || !signature) {
    throw new Error("State token missing required fields");
  }

  // Verify HMAC signature
  const message = `${tenantId}:${issuedAt}`;
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(message)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSig, "hex");
  const receivedBuf = Buffer.from(signature, "hex");
  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    throw new Error("State token signature is invalid");
  }

  // Verify max age
  const issuedAtMs = parseInt(issuedAt, 10);
  if (isNaN(issuedAtMs) || Date.now() - issuedAtMs > STATE_MAX_AGE_MS) {
    throw new Error("State token has expired (max age 10 minutes)");
  }

  return tenantId;
}

// ── Meta API Helpers ──────────────────────────────────────────────────────────

interface ShortLivedTokenResponse {
  access_token: string;
  token_type: string;
}

/**
 * Exchanges the authorization code for a short-lived user access token.
 */
async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<string> {
  const url = new URL(`${META_GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", getMetaAppId());
  url.searchParams.set("client_secret", getMetaAppSecret());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Code exchange failed (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as ShortLivedTokenResponse;
  if (!data.access_token) {
    throw new Error("Code exchange response missing access_token");
  }
  return data.access_token;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Exchanges a short-lived token for a 60-day long-lived token.
 * Returns { token, expiresAt }.
 */
async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ token: string; expiresAt: Date }> {
  const url = new URL(`${META_GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", getMetaAppId());
  url.searchParams.set("client_secret", getMetaAppSecret());
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Long-lived token exchange failed (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as LongLivedTokenResponse;
  if (!data.access_token) {
    throw new Error("Long-lived token exchange response missing access_token");
  }

  // Default to 59 days (conservative) if expires_in is not returned
  const expiresInSeconds = data.expires_in ?? 59 * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  return { token: data.access_token, expiresAt };
}

interface AdAccount {
  id: string;
  name: string;
  account_id: string;
}

interface AdAccountsResponse {
  data: AdAccount[];
}

/**
 * Fetches the first ad account accessible to the user.
 * Returns the account ID in act_XXXXXXX format.
 */
async function fetchAdAccountId(accessToken: string): Promise<string> {
  const url = new URL(`${META_GRAPH_API_BASE}/me/adaccounts`);
  url.searchParams.set("fields", "id,name,account_id");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch ad accounts (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as AdAccountsResponse;
  const first = data.data?.[0];
  if (!first?.id) {
    throw new Error(
      "No ad accounts found for this Meta user. " +
      "Ensure the user has access to at least one Meta Ad Account."
    );
  }
  return first.id; // Already in act_XXXXXXX format
}

interface Page {
  id: string;
  name: string;
}

interface PagesResponse {
  data: Page[];
}

/**
 * Fetches the first Facebook Page accessible to the user.
 */
async function fetchPageId(accessToken: string): Promise<string> {
  const url = new URL(`${META_GRAPH_API_BASE}/me/accounts`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch pages (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as PagesResponse;
  const first = data.data?.[0];
  if (!first?.id) {
    throw new Error(
      "No Facebook Pages found for this Meta user. " +
      "Ensure the user has at least one Facebook Page."
    );
  }
  return first.id;
}

interface Pixel {
  id: string;
  name: string;
}

interface PixelsResponse {
  data: Pixel[];
}

/**
 * Fetches the first Pixel associated with the ad account.
 * Returns an empty string if no pixel exists (non-fatal).
 */
async function fetchPixelId(
  adAccountId: string,
  accessToken: string
): Promise<string> {
  const url = new URL(`${META_GRAPH_API_BASE}/${adAccountId}/adspixels`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return "";
    const data = (await res.json()) as PixelsResponse;
    return data.data?.[0]?.id ?? "";
  } catch {
    // Non-fatal — pixel can be configured later
    return "";
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const dashboardUrl = `${origin}/`;

  const redirectError = (reason: string): NextResponse => {
    console.error(`[meta/callback] Error: ${reason}`);
    const url = new URL(dashboardUrl);
    url.searchParams.set("meta_error", encodeURIComponent(reason));
    return NextResponse.redirect(url.toString());
  };

  // ── 1. Extract query params ───────────────────────────────────────────────
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // User denied permissions
  if (error) {
    return redirectError(
      errorDescription ?? error ?? "Meta OAuth permission denied"
    );
  }

  if (!code) {
    return redirectError("No authorization code received from Meta");
  }

  if (!state) {
    return redirectError("No state parameter received — possible CSRF attack");
  }

  // ── 2. Validate CSRF state ────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = verifyStateToken(state);
  } catch (err) {
    return redirectError(
      `State validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 3. Exchange code for short-lived token ────────────────────────────────
  const redirectUri = `${origin}/api/auth/meta/callback`;
  let shortLivedToken: string;
  try {
    shortLivedToken = await exchangeCodeForToken(code, redirectUri);
  } catch (err) {
    return redirectError(
      `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 4. Exchange for 60-day long-lived token ───────────────────────────────
  let longLivedToken: string;
  let tokenExpiresAt: Date;
  try {
    const result = await exchangeForLongLivedToken(shortLivedToken);
    longLivedToken = result.token;
    tokenExpiresAt = result.expiresAt;
  } catch (err) {
    return redirectError(
      `Long-lived token exchange failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 5. Fetch ad account, page, and pixel IDs ──────────────────────────────
  let adAccountId: string;
  let pageId: string;
  let pixelId: string;

  try {
    adAccountId = await fetchAdAccountId(longLivedToken);
  } catch (err) {
    return redirectError(
      `Failed to fetch ad account: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    pageId = await fetchPageId(longLivedToken);
  } catch (err) {
    return redirectError(
      `Failed to fetch Facebook Page: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Pixel fetch is non-fatal — empty string if not found
  pixelId = await fetchPixelId(adAccountId, longLivedToken);

  // ── 6. Encrypt token and upsert MetaConnection ────────────────────────────
  let encryptedToken: string;
  try {
    encryptedToken = encryptToken(longLivedToken);
  } catch (err) {
    return redirectError(
      `Token encryption failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    await prisma.metaConnection.upsert({
      where: { tenantId },
      create: {
        tenantId,
        encryptedAccessToken: encryptedToken,
        adAccountId,
        pageId,
        pixelId,
        tokenExpiresAt,
      },
      update: {
        encryptedAccessToken: encryptedToken,
        adAccountId,
        pageId,
        pixelId,
        tokenExpiresAt,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    return redirectError(
      `Failed to save Meta connection: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 7. Redirect to dashboard with success status ──────────────────────────
  const successUrl = new URL(dashboardUrl);
  successUrl.searchParams.set("meta_connected", "true");
  return NextResponse.redirect(successUrl.toString());
}
