/**
 * src/app/onboarding/page.tsx
 * Full-screen onboarding page.
 *
 * Shown only on first login — when the tenant has no existing CampaignBlueprints.
 * After completion, the OnboardingChat component redirects to the dashboard.
 *
 * Server component: checks DB for existing blueprints and redirects if found.
 * This prevents returning agency owners from ever seeing the onboarding flow again.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import OnboardingChat from "@/components/onboarding/OnboardingChat";

export const metadata = {
  title: "Set up your client — Aurum",
  description: "Set up your first client campaign in under two minutes.",
};

export default async function OnboardingPage() {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const { orgId } = await auth();

  if (!orgId) {
    // Not authenticated — Clerk middleware should handle this, but guard anyway
    redirect("/sign-in");
  }

  // ── Check for existing blueprints ───────────────────────────────────────────
  // If the agency owner already has at least one blueprint, they've completed
  // onboarding. Redirect them to the dashboard immediately.
  const existingBlueprintCount = await prisma.campaignBlueprint.count({
    where: { tenantId: orgId },
  });

  if (existingBlueprintCount > 0) {
    redirect("/");
  }

  // ── First-time user — show onboarding ──────────────────────────────────────
  return <OnboardingChat />;
}
