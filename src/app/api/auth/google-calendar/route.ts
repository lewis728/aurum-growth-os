/**
 * src/app/api/auth/google-calendar/route.ts
 * GET /api/auth/google-calendar
 *
 * Initiates the Google OAuth flow for calendar access.
 *
 * Flow:
 *   1. Verify authenticated Clerk session via getTenantId().
 *   2. Build CSRF-safe state token (HMAC-SHA256 signed with CLERK_SECRET_KEY).
 *   3. Construct Google OAuth URL with scope: calendar.events.
 *   4. Redirect browser to Google's consent screen.
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID    — Google OAuth app client ID
 *   CLERK_SECRET_KEY    — Used to sign the CSRF state token
 *
 * Scopes requested:
 *   https://www.googleapis.com/auth/calendar.events
 *     — Create and manage events on the user's calendars
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getTenantId } from "@/lib/auth";

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

// ── Environment Guards ────────────────────────────────────────────────────────

function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error("GOOGLE_CLIENT_ID is not configured");
  return id;
}

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not configured");
  return key;
}

// ── CSRF State Token ──────────────────────────────────────────────────────────

/**
 * Builds a signed CSRF state token.
 * Format: base64url-encoded JSON { tenantId, issuedAt, signature }
 * Signature: HMAC-SHA256(tenantId + ":" + issuedAt, CLERK_SECRET_KEY)
 */
export function buildGoogleStateToken(tenantId: string): string {
  const key = getClerkSecretKey();
  const issuedAt = Date.now().toString();
  const message = `${tenantId}:${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", key)
    .update(message)
    .digest("hex");
  const payload = JSON.stringify({ tenantId, issuedAt, signature });
  return Buffer.from(payload).toString("base64url");
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── 1. Authenticate ───────────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Build redirect URI ─────────────────────────────────────────────────
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google-calendar/callback`;

  // ── 3. Build CSRF state token ─────────────────────────────────────────────
  let state: string;
  try {
    state = buildGoogleStateToken(tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google-calendar/oauth] Failed to build state token:", msg);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // ── 4. Build Google OAuth URL ─────────────────────────────────────────────
  let clientId: string;
  try {
    clientId = getGoogleClientId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google-calendar/oauth] Missing GOOGLE_CLIENT_ID:", msg);
    return NextResponse.json(
      { error: "Server configuration error — GOOGLE_CLIENT_ID not set" },
      { status: 500 }
    );
  }

  const oauthUrl = new URL(GOOGLE_OAUTH_BASE);
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("scope", CALENDAR_SCOPE);
  oauthUrl.searchParams.set("access_type", "offline");   // Request refresh token
  oauthUrl.searchParams.set("prompt", "consent");         // Force consent to get refresh token
  oauthUrl.searchParams.set("state", state);

  // ── 5. Redirect to Google ─────────────────────────────────────────────────
  return NextResponse.redirect(oauthUrl.toString());
}
