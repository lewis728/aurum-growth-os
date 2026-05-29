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
  // ── Auth + onboarding guards ─────────────────────────────────────────────
  // Guard 1: signed in but no org → create one first
  // Guard 2: has org but no blueprints → complete onboarding
  try {
    const { userId, orgId } = await auth();

    // Signed in but no organisation yet — auto-create one on /setup-org
    if (userId && !orgId) {
      redirect("/setup-org");
    }

    if (orgId) {
      const blueprintCount = await prisma.campaignBlueprint.count({
        where: { tenantId: orgId },
      });
      if (blueprintCount === 0) {
        redirect("/onboarding");
      }
    }
  } catch (err) {
    // Re-throw Next.js redirect signals — they must propagate
    if (
      err instanceof Error &&
      (err.message === "NEXT_REDIRECT" || (err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT"))
    ) {
      throw err;
    }
    // auth() threw for another reason — fall through gracefully
  }

  return (
    <div className="min-h-screen bg-white">
      {/* SubscriptionBanner handles its own state — layout does not need to know subscription status */}
      <SubscriptionBanner />
      {children}
    </div>
  );
}
