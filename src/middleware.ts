// src/middleware.ts
// Clerk authentication middleware for Aurum Growth OS.
// Protects /api/(.*) and /(dashboard)/(.*) routes.
// Webhook routes are explicitly public — they are called by Retell, Meta, and Twilio.
// Rate limiting: 20 requests/minute per tenantId on /api/chat.
// Custom domain resolution: resolves agency custom domains to tenantId via x-agency-tenant-id header.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { getBrandingByDomain } from "@/lib/services/brandingService";

// ── Route matchers ────────────────────────────────────────────────────────────
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/api/cron/(.*)",
  "/api/debug(.*)",
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

/**
 * Extracts the hostname from a request, stripping port numbers.
 */
function extractHostname(req: NextRequest): string {
  const host = req.headers.get("host") ?? "";
  return host.split(":")[0] ?? "";
}

/**
 * Extracts the hostname from a URL string.
 */
function extractAppHostname(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  try {
    return new URL(appUrl).hostname;
  } catch {
    return "";
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
export default clerkMiddleware(async (auth, req) => {
  // ── Step 1: Custom domain resolution ─────────────────────────────────────
  // If the request hostname does not match the main app hostname,
  // attempt to resolve it to an agency tenantId via AgencyBranding.customDomain.
  // This allows app.theiragency.com to resolve to the correct agency context.
  const requestHostname = extractHostname(req);
  const appHostname = extractAppHostname();

  const resolvedHeaders: Record<string, string> = {};

  if (requestHostname && appHostname && requestHostname !== appHostname) {
    try {
      const branding = await getBrandingByDomain(requestHostname);
      if (branding) {
        resolvedHeaders["x-agency-tenant-id"] = branding.tenantId;
      }
    } catch {
      // Non-fatal — continue without setting the header
    }
  }

  // ── Step 2: Clerk auth protection ────────────────────────────────────────
  if (!isPublicRoute(req)) {
    auth().protect();
  }

  // ── Step 3: Rate limit /api/chat ──────────────────────────────────────────
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

  // ── Step 4: Forward resolved headers if any ───────────────────────────────
  if (Object.keys(resolvedHeaders).length > 0) {
    const requestHeaders = new Headers(req.headers);
    for (const [key, value] of Object.entries(resolvedHeaders)) {
      requestHeaders.set(key, value);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
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
