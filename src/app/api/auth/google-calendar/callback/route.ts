/**
 * src/app/api/auth/google-calendar/callback/route.ts
 * GET /api/auth/google-calendar/callback
 *
 * Handles the Google OAuth callback after the user grants calendar access.
 *
 * Flow:
 *   1. Validate the CSRF state token (HMAC signature + max-age check).
 *   2. Exchange the authorization code for access + refresh tokens.
 *   3. Fetch the user's primary calendar ID from the Calendar API.
 *   4. Encrypt both tokens and upsert into CalendarConnection table.
 *   5. Redirect to the dashboard with ?calendar_connected=google.
 *
 * On any error, redirects to the dashboard with ?calendar_error=<reason>.
 * Tokens are NEVER returned to the client.
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID      — Google OAuth app client ID
 *   GOOGLE_CLIENT_SECRET  — Google OAuth app client secret (server-only)
 *   CLERK_SECRET_KEY      — Used to verify the CSRF state signature
 *   META_TOKEN_ENCRYPTION_KEY — Reused for AES-256-CBC token encryption
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/services/metaAuthService";
import { CalendarProvider } from "@prisma/client";

export const dynamic = "force-dynamic";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// ── State token max age: 10 minutes ──────────────────────────────────────────
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ── Environment Guards ────────────────────────────────────────────────────────

function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not configured");
  return id;
}

function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not configured");
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

// ── Google Token Exchange ─────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  error?: string;
  error_description?: string;
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  const data = (await res.json()) as GoogleTokenResponse;

  if (!res.ok || data.error) {
    const msg = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    throw new Error(`Google token exchange failed: ${msg}`);
  }

  if (!data.access_token) {
    throw new Error("Google token exchange response missing access_token");
  }

  const expiresInSeconds = data.expires_in ?? 3600;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  };
}

// ── Calendar ID Fetch ─────────────────────────────────────────────────────────

interface CalendarListEntry {
  id: string;
  primary?: boolean;
  summary?: string;
}

interface CalendarListResponse {
  items?: CalendarListEntry[];
  error?: { message: string };
}

/**
 * Fetches the user's primary Google Calendar ID.
 * Falls back to "primary" (a Google alias) if the list call fails.
 */
async function fetchPrimaryCalendarId(accessToken: string): Promise<string> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=owner`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) return "primary";

    const data = (await res.json()) as CalendarListResponse;
    const primary = data.items?.find((c) => c.primary === true);
    return primary?.id ?? "primary";
  } catch {
    // Non-fatal — "primary" is a valid Google Calendar alias
    return "primary";
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const dashboardUrl = `${origin}/`;

  const redirectError = (reason: string): NextResponse => {
    console.error(`[google-calendar/callback] Error: ${reason}`);
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
        ? "Google Calendar access was denied"
        : `Google OAuth error: ${error}`
    );
  }

  if (!code) return redirectError("No authorization code received from Google");
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

  // ── 3. Exchange code for tokens ───────────────────────────────────────────
  const redirectUri = `${origin}/api/auth/google-calendar/callback`;
  let accessToken: string;
  let refreshToken: string | null;
  let expiresAt: Date;

  try {
    const result = await exchangeCodeForTokens(code, redirectUri);
    accessToken = result.accessToken;
    refreshToken = result.refreshToken;
    expiresAt = result.expiresAt;
  } catch (err) {
    return redirectError(
      `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 4. Fetch primary calendar ID ──────────────────────────────────────────
  const calendarId = await fetchPrimaryCalendarId(accessToken);

  // ── 5. Encrypt tokens and upsert CalendarConnection ───────────────────────
  let encryptedAccessToken: string;
  let encryptedRefreshToken: string | null = null;

  try {
    encryptedAccessToken = encryptToken(accessToken);
    if (refreshToken) {
      encryptedRefreshToken = encryptToken(refreshToken);
    }
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
        provider: CalendarProvider.GOOGLE,
        encryptedToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        calendarId,
        expiresAt,
      },
      update: {
        provider: CalendarProvider.GOOGLE,
        encryptedToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        calendarId,
        expiresAt,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    return redirectError(
      `Failed to save calendar connection: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 6. Redirect to dashboard with success ─────────────────────────────────
  const successUrl = new URL(dashboardUrl);
  successUrl.searchParams.set("calendar_connected", "google");
  return NextResponse.redirect(successUrl.toString());
}
