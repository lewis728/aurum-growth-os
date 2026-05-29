/**
 * src/app/(dashboard)/layout.tsx
 * Dashboard route group layout — white background wrapper.
 * All routes under (dashboard)/ inherit this layout.
 *
 * Onboarding guard: if the authenticated tenant has no blueprints,
 * redirect to /onboarding. This ensures first-time agency owners always
 * complete the client setup flow before accessing the dashboard.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { SubscriptionBanner } from "@/components/access/SubscriptionBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Onboarding redirect guard ─────────────────────────────────────────────
  // Only runs for authenticated users (Clerk middleware protects the route).
  // Wrapped in try/catch: if Clerk context is unavailable (e.g. unauthenticated
  // requests that bypass the middleware matcher), fall through gracefully.
  try {
    const { orgId } = await auth();
    if (orgId) {
      const blueprintCount = await prisma.campaignBlueprint.count({
        where: { tenantId: orgId },
      });
      if (blueprintCount === 0) {
        redirect("/onboarding");
      }
    }
  } catch {
    // auth() threw — Clerk context unavailable. Fall through; page-level
    // SignedIn/SignedOut guards will handle the authentication state.
  }

  return (
    <div className="min-h-screen bg-white">
      {/* SubscriptionBanner handles its own state — layout does not need to know subscription status */}
      <SubscriptionBanner />
      {children}
    </div>
  );
}
