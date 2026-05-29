/**
 * Minimal pass-through middleware.
 *
 * We do NOT use clerkMiddleware here because it imports node:async_hooks
 * (via AsyncLocalStorage) which crashes silently in Vercel's Edge runtime.
 *
 * Authentication is handled directly in each API route handler using
 * @clerk/backend's authenticateRequest() via src/lib/serverAuth.ts.
 */
import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
