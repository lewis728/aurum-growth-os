/**
 * src/app/api/auth/meta/route.ts
 * GET /api/auth/meta
 *
 * Initiates the Meta OAuth flow for the authenticated tenant.
 *
 * Flow:
 *   1. Verify the request is from an authenticated Clerk session (getTenantId).
 *   2. Build a CSRF-safe state parameter: HMAC-SHA256(tenantId + timestamp) signed
 *      with CLERK_SECRET_KEY, encoded as base64url JSON.
 *   3. Construct the Meta OAuth URL with required scopes.
 *   4. Redirect the browser to Meta's login page.
 *
 * Required environment variables:
 *   META_APP_ID       — Meta App ID from Meta Developer Portal
 *   CLERK_SECRET_KEY  — Used to sign the CSRF state token (already present)
 *
 * Scopes requested:
 *   ads_management      — Create and manage ad campaigns
 *   ads_read            — Read campaign performance data
 *   business_management — Access Business Manager assets
 *   pages_read_engagement — Read Page engagement data
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuth, getServerTenantId } from "@/lib/serverAuth";
import crypto from "crypto";
export const dynamic = "force-dynamic";

const META_OAUTH_BASE = "https://www.facebook.com/v19.0/dialog/oauth";

const REQUIRED_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_read_engagement",
].join(",");

// ── Environment Guards ────────────────────────────────────────────────────────

function getMetaAppId(): string {
  const id = process.env.META_APP_ID;
  if (!id) throw new Error("META_APP_ID is not configured");
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
 *
 * Structure (base64url-encoded JSON):
 *   { tenantId, issuedAt, signature }
 *
 * The signature is HMAC-SHA256(tenantId + ":" + issuedAt, CLERK_SECRET_KEY).
 * The callback route verifies the signature before processing the OAuth code.
 */
function buildStateToken(tenantId: string): string {
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
    tenantId = await getServerTenantId(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Build redirect URI ─────────────────────────────────────────────────
  // The redirect_uri must exactly match what is registered in the Meta App
  // dashboard. We derive it from the request origin so it works across
  // development and production without hardcoding.
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/meta/callback`;

  // ── 3. Build CSRF state token ─────────────────────────────────────────────
  let state: string;
  try {
    state = buildStateToken(tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/oauth] Failed to build state token:", msg);
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // ── 4. Build Meta OAuth URL ───────────────────────────────────────────────
  let appId: string;
  try {
    appId = getMetaAppId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/oauth] Missing META_APP_ID:", msg);
    return NextResponse.json(
      { error: "Server configuration error — META_APP_ID not set" },
      { status: 500 }
    );
  }

  const oauthUrl = new URL(META_OAUTH_BASE);
  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("scope", REQUIRED_SCOPES);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("state", state);

  // ── 5. Redirect to Meta ───────────────────────────────────────────────────
  return NextResponse.redirect(oauthUrl.toString());
}
