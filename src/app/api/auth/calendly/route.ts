/**
 * src/app/api/auth/calendly/route.ts
 * GET /api/auth/calendly
 *
 * Initiates the Calendly OAuth flow.
 *
 * Flow:
 *   1. Verify authenticated Clerk session via getTenantId().
 *   2. Build CSRF-safe state token (HMAC-SHA256 signed with CLERK_SECRET_KEY).
 *   3. Redirect browser to Calendly's OAuth consent screen.
 *
 * The callback route handles token exchange, user URI fetch, and
 * webhook subscription for invitee.created / invitee.canceled events.
 *
 * Required environment variables:
 *   CALENDLY_CLIENT_ID  — Calendly OAuth app client ID
 *   CLERK_SECRET_KEY    — Used to sign the CSRF state token
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@clerk/nextjs/server";
export const dynamic = "force-dynamic";

const CALENDLY_OAUTH_BASE = "https://auth.calendly.com/oauth/authorize";

// ── Environment Guards ────────────────────────────────────────────────────────

function getCalendlyClientId(): string {
  const id = process.env.CALENDLY_CLIENT_ID;
  if (!id) throw new Error("CALENDLY_CLIENT_ID is not configured");
  return id;
}

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not configured");
  return key;
}

// ── CSRF State Token ──────────────────────────────────────────────────────────

function buildCalendlyStateToken(tenantId: string): string {
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
const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId;

  // ── 2. Build redirect URI ─────────────────────────────────────────────────
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/calendly/callback`;

  // ── 3. Build CSRF state token ─────────────────────────────────────────────
  let state: string;
  try {
    state = buildCalendlyStateToken(tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendly/oauth] Failed to build state token:", msg);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // ── 4. Build Calendly OAuth URL ───────────────────────────────────────────
  let clientId: string;
  try {
    clientId = getCalendlyClientId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendly/oauth] Missing CALENDLY_CLIENT_ID:", msg);
    return NextResponse.json(
      { error: "Server configuration error — CALENDLY_CLIENT_ID not set" },
      { status: 500 }
    );
  }

  const oauthUrl = new URL(CALENDLY_OAUTH_BASE);
  oauthUrl.searchParams.set("client_id", clientId);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("state", state);

  // ── 5. Redirect to Calendly ───────────────────────────────────────────────
  return NextResponse.redirect(oauthUrl.toString());
}
