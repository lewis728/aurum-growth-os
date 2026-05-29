/**
 * src/app/onboarding/page.tsx
 * Full-screen onboarding page.
 *
 * Shown only on first login — when the tenant has no existing CampaignBlueprints.
 * After completion, the OnboardingChat component redirects to the dashboard.
 *
 * Server component: checks DB for existing blueprints and redirects if found.
 * This prevents returning agency owners from ever seeing the onboarding flow again.
 *
 * NOTE: We intentionally do NOT redirect to /setup-org when orgId is null.
 * The user arrives here from /setup-org after setActive() — the Clerk JWT cookie
 * may still be propagating. Redirecting back to /setup-org here causes an
 * infinite loop. The OnboardingChat component handles the unauthenticated state
 * gracefully on the client side.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import OnboardingChat from "@/components/onboarding/OnboardingChat";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set up your client — Aurum",
  description: "Set up your first client campaign in under two minutes.",
};

export default async function OnboardingPage() {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const { userId, orgId } = await auth();

  if (!userId) {
    // Not authenticated at all — Clerk middleware should handle this
    redirect("/sign-in");
  }

  // If orgId is null here, the JWT cookie is still propagating after setActive().
  // Do NOT redirect to /setup-org — that causes an infinite loop.
  // Just render the page; OnboardingChat will handle the state client-side.

  // ── Check for existing blueprints (only if we have an org) ─────────────────
  if (orgId) {
    const existingBlueprintCount = await prisma.campaignBlueprint.count({
      where: { tenantId: orgId },
    });
    if (existingBlueprintCount > 0) {
      redirect("/");
    }
  }

  // ── Render onboarding ──────────────────────────────────────────────────────
  return <OnboardingChat />;
}
