/**
 * src/lib/serverAuth.ts
 *
 * Server-side auth helper that works WITHOUT clerkMiddleware.
 *
 * Clerk's auth() from @clerk/nextjs/server requires the x-clerk-auth-status
 * header to be set by clerkMiddleware. On Vercel, clerkMiddleware crashes
 * silently in the Edge runtime because it uses node:async_hooks.
 *
 * This helper uses @clerk/backend's authenticateRequest() directly, which
 * reads the session token from cookies and verifies it against Clerk's JWKS
 * endpoint — no middleware headers needed.
 *
 * Usage in API route handlers:
 *   const { userId, orgId } = await getServerAuth(req);
 *   if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 */
import { createClerkClient } from "@clerk/backend";
import type { NextRequest } from "next/server";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
});

export interface ServerAuthResult {
  userId: string | null;
  orgId: string | null;
  sessionId: string | null;
}

/**
 * Authenticate a request using Clerk's backend SDK directly.
 * Works without clerkMiddleware — reads session token from cookies.
 */
export async function getServerAuth(req: NextRequest): Promise<ServerAuthResult> {
  try {
    const requestState = await clerkClient.authenticateRequest(req, {
      secretKey: process.env.CLERK_SECRET_KEY!,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
    });

    if (!requestState.isSignedIn) {
      return { userId: null, orgId: null, sessionId: null };
    }

    const payload = requestState.toAuth();
    return {
      userId: payload?.userId ?? null,
      orgId: payload?.orgId ?? null,
      sessionId: payload?.sessionId ?? null,
    };
  } catch (err) {
    console.error("[serverAuth] authenticateRequest failed:", err instanceof Error ? err.message : String(err));
    return { userId: null, orgId: null, sessionId: null };
  }
}

/**
 * Get the tenant (org) ID from the request, throwing if not found.
 * Drop-in replacement for getTenantId() in route handlers.
 */
export async function getServerTenantId(req: NextRequest): Promise<string> {
  const { orgId } = await getServerAuth(req);
  if (!orgId) {
    throw new Error("UNAUTHORIZED: No organisation context in session");
  }
  return orgId;
}

/**
 * Get the user ID from the request, throwing if not found.
 */
export async function getServerUserId(req: NextRequest): Promise<string> {
  const { userId } = await getServerAuth(req);
  if (!userId) {
    throw new Error("UNAUTHORIZED: User is not authenticated");
  }
  return userId;
}
