import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

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

export default clerkMiddleware((auth, req: NextRequest) => {
  if (!isPublicRoute(req)) {
    auth().protect();
  }
  // Add a custom header to confirm middleware ran
  const response = NextResponse.next();
  response.headers.set("x-middleware-ran", "true");
  return response;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
