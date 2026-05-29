import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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

export default clerkMiddleware((auth, req) => {
  const url = req.nextUrl.pathname;
  console.log(`[middleware] ${url} | public=${isPublicRoute(req)}`);
  
  if (!isPublicRoute(req)) {
    try {
      const authObj = auth();
      console.log(`[middleware] userId=${authObj.userId} | protecting...`);
      authObj.protect();
      console.log(`[middleware] protect() passed`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[middleware] protect() threw: ${msg.slice(0, 100)}`);
      // Re-throw so Clerk can handle the redirect
      throw e;
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
