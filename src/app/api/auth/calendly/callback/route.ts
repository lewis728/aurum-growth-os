/**
 * src/app/api/auth/calendly/callback/route.ts
 * GET /api/auth/calendly/callback
 *
 * Handles the Calendly OAuth callback.
 *
 * Flow:
 *   1. Validate the CSRF state token.
 *   2. Exchange the authorization code for an access token.
 *   3. Fetch the Calendly user URI (used as calendarId in CalendarConnection).
 *   4. Subscribe to Calendly webhook events: invitee.created, invitee.canceled.
 *      The webhook endpoint is /api/webhooks/calendly.
 *   5. Encrypt the token and upsert into CalendarConnection table.
 *   6. Redirect to dashboard with ?calendar_connected=calendly.
 *
 * Required environment variables:
 *   CALENDLY_CLIENT_ID      — Calendly OAuth app client ID
 *   CALENDLY_CLIENT_SECRET  — Calendly OAuth app client secret (server-only)
 *   CALENDLY_WEBHOOK_SECRET — Used to validate inbound Calendly webhooks
 *   CLERK_SECRET_KEY        — Used to verify the CSRF state signature
 *   META_TOKEN_ENCRYPTION_KEY — Reused for AES-256-CBC token encryption
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/services/metaAuthService";
import { CalendarProvider } from "@prisma/client";

export const dynamic = "force-dynamic";

const CALENDLY_TOKEN_URL = "https://auth.calendly.com/oauth/token";
const CALENDLY_API_BASE = "https://api.calendly.com";

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ── Environment Guards ────────────────────────────────────────────────────────

function getCalendlyClientId(): string {
  const id = process.env.CALENDLY_CLIENT_ID;
  if (!id) throw new Error("CALENDLY_CLIENT_ID is not configured");
  return id;
}

function getCalendlyClientSecret(): string {
  const secret = process.env.CALENDLY_CLIENT_SECRET;
  if (!secret) throw new Error("CALENDLY_CLIENT_SECRET is not configured");
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

  const issuedAtMs = parseInt(issuedAt, 10);
  if (isNaN(issuedAtMs) || Date.now() - issuedAtMs > STATE_MAX_AGE_MS) {
    throw new Error("State token has expired (max age 10 minutes)");
  }

  return tenantId;
}

// ── Calendly Token Exchange ───────────────────────────────────────────────────

interface CalendlyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const credentials = Buffer.from(
    `${getCalendlyClientId()}:${getCalendlyClientSecret()}`
  ).toString("base64");

  const res = await fetch(CALENDLY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const data = (await res.json()) as CalendlyTokenResponse;

  if (!res.ok || data.error) {
    const msg = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    throw new Error(`Calendly token exchange failed: ${msg}`);
  }

  if (!data.access_token) {
    throw new Error("Calendly token exchange response missing access_token");
  }

  // Calendly tokens are long-lived; expires_in may not be present
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;

  return { accessToken: data.access_token, expiresAt };
}

// ── Calendly User URI ─────────────────────────────────────────────────────────

interface CalendlyUserResponse {
  resource?: { uri: string; name: string };
  error?: { message: string };
}

async function fetchCalendlyUserUri(accessToken: string): Promise<string> {
  const res = await fetch(`${CALENDLY_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch Calendly user (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as CalendlyUserResponse;
  if (!data.resource?.uri) {
    throw new Error("Calendly user response missing resource.uri");
  }

  return data.resource.uri;
}

// ── Calendly Webhook Subscription ────────────────────────────────────────────

interface CalendlyWebhookSubscriptionResponse {
  resource?: { uri: string };
  error?: { message: string };
}

/**
 * Subscribes to Calendly webhook events for the given user URI.
 * Events: invitee.created, invitee.canceled
 *
 * Non-fatal — logs a warning if subscription fails but does not block
 * the OAuth flow. The tenant can reconnect to retry.
 */
async function subscribeToCalendlyWebhooks(
  accessToken: string,
  userUri: string,
  webhookUrl: string
): Promise<void> {
  const body = {
    url: webhookUrl,
    events: ["invitee.created", "invitee.canceled"],
    user: userUri,
    scope: "user",
  };

  try {
    const res = await fetch(`${CALENDLY_API_BASE}/webhook_subscriptions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as CalendlyWebhookSubscriptionResponse;

    if (!res.ok) {
      // 409 Conflict means a subscription already exists — not an error
      if (res.status === 409) {
        console.log("[calendly/callback] Webhook subscription already exists — skipping");
        return;
      }
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      console.warn(`[calendly/callback] Webhook subscription failed: ${msg}`);
      return;
    }

    console.log(
      `[calendly/callback] Webhook subscription created: ${data.resource?.uri ?? "unknown"}`
    );
  } catch (err) {
    console.warn(
      "[calendly/callback] Webhook subscription error:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const dashboardUrl = `${origin}/`;

  const redirectError = (reason: string): NextResponse => {
    console.error(`[calendly/callback] Error: ${reason}`);
    const url = new URL(dashboardUrl);
    url.searchParams.set("calendar_error", encodeURIComponent(reason));
    return NextResponse.redirect(url.toString());
  };

  // ── 1. Extract query params ───────────────────────────────────────────────
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return redirectError(
      error === "access_denied"
        ? "Calendly access was denied"
        : `Calendly OAuth error: ${error}`
    );
  }

  if (!code) return redirectError("No authorization code received from Calendly");
  if (!state) return redirectError("No state parameter received — possible CSRF attack");

  // ── 2. Validate CSRF state ────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = verifyStateToken(state);
  } catch (err) {
    return redirectError(
      `State validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 3. Exchange code for access token ─────────────────────────────────────
  const redirectUri = `${origin}/api/auth/calendly/callback`;
  let accessToken: string;
  let expiresAt: Date | null;

  try {
    const result = await exchangeCodeForToken(code, redirectUri);
    accessToken = result.accessToken;
    expiresAt = result.expiresAt;
  } catch (err) {
    return redirectError(
      `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 4. Fetch Calendly user URI ────────────────────────────────────────────
  let userUri: string;
  try {
    userUri = await fetchCalendlyUserUri(accessToken);
  } catch (err) {
    return redirectError(
      `Failed to fetch Calendly user: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 5. Subscribe to webhook events (non-fatal) ────────────────────────────
  const webhookUrl = `${origin}/api/webhooks/calendly`;
  await subscribeToCalendlyWebhooks(accessToken, userUri, webhookUrl);

  // ── 6. Encrypt token and upsert CalendarConnection ────────────────────────
  let encryptedAccessToken: string;
  try {
    encryptedAccessToken = encryptToken(accessToken);
  } catch (err) {
    return redirectError(
      `Token encryption failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    await prisma.calendarConnection.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider: CalendarProvider.CALENDLY,
        encryptedToken: encryptedAccessToken,
        calendarId: userUri,
        expiresAt,
      },
      update: {
        provider: CalendarProvider.CALENDLY,
        encryptedToken: encryptedAccessToken,
        calendarId: userUri,
        expiresAt,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    return redirectError(
      `Failed to save Calendly connection: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 7. Redirect to dashboard with success ─────────────────────────────────
  const successUrl = new URL(dashboardUrl);
  successUrl.searchParams.set("calendar_connected", "calendly");
  return NextResponse.redirect(successUrl.toString());
}
