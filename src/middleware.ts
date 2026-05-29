// src/middleware.ts
// Clerk authentication middleware for Aurum Growth OS.
// Protects /api/(.*) and /(dashboard)/(.*) routes.
// Webhook routes are explicitly public — they are called by Retell, Meta, and Twilio.
// Rate limiting: 20 requests/minute per tenantId on /api/chat.
//
// NOTE: Custom domain resolution (getBrandingByDomain) has been moved out of
// middleware because:
//   1. Middleware runs in the Edge runtime — Prisma (Node.js only) cannot be imported.
//   2. Calling a Next.js API route from middleware causes recursive middleware execution.
// Custom domain resolution is handled at the page/layout level instead.

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

// ── Route matchers ────────────────────────────────────────────────────────────
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/api/cron/(.*)",
  "/api/debug(.*)",
  "/api/branding/(.*)",
  "/api/test(.*)",
]);

const isChatRoute = createRouteMatcher(["/api/chat"]);

// ── In-memory rate limiter ────────────────────────────────────────────────────
// LRU-style Map: key = tenantId, value = { count, resetAt }
// Entries are cleaned up lazily when the window expires.
interface RateLimitEntry {
  count:   number;
  resetAt: number; // Unix ms
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX    = 20;   // requests
const RATE_LIMIT_WINDOW = 60_000; // 60 seconds in ms

/**
 * Returns true if the tenantId has exceeded the rate limit.
 * Side-effect: increments the counter for the tenantId.
 */
function isRateLimited(tenantId: string): boolean {
  const now  = Date.now();
  const entry = rateLimitStore.get(tenantId);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(tenantId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count += 1;
  return false;
}

/**
 * Extracts the tenantId (Clerk orgId) from the request for rate limiting.
 * Falls back to IP address if orgId is not available (pre-auth requests).
 */
function extractRateLimitKey(req: NextRequest, orgId: string | null | undefined): string {
  if (orgId) return orgId;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]?.trim() : "unknown";
  return ip ?? "unknown";
}

// ── Middleware ────────────────────────────────────────────────────────────────
export default clerkMiddleware(async (auth, req) => {
  // ── Clerk auth protection ─────────────────────────────────────────────────
  // auth() returns ClerkMiddlewareAuthObject; protect() redirects unauthenticated
  // users to the Clerk sign-in page. Wrapped in try/catch so any unexpected
  // Clerk error returns a clean 401 JSON instead of an empty 500.
  if (!isPublicRoute(req)) {
    try {
      auth().protect();
    } catch {
      // If protect() throws (e.g. Clerk misconfiguration), return 401 for API
      // routes and redirect to sign-in for page routes.
      const isApiRoute = req.nextUrl.pathname.startsWith("/api/");
      if (isApiRoute) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const signInUrl = new URL("/sign-in", req.url);
      signInUrl.searchParams.set("redirect_url", req.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  // ── Rate limit /api/chat ──────────────────────────────────────────────────
  if (isChatRoute(req) && req.method === "POST") {
    const { orgId } = auth();
    const key = extractRateLimitKey(req, orgId);

    if (isRateLimited(key)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait before sending another message." },
        {
          status:  429,
          headers: { "Retry-After": "60" },
        }
      );
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
