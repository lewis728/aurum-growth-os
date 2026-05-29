/**
 * src/app/(dashboard)/layout.tsx
 * Dashboard route group layout — white background wrapper.
 * All routes under (dashboard)/ inherit this layout.
 *
 * Guards (evaluated before rendering):
 *   1. Signed in but no org  → redirect to /setup-org
 *      (skipped when already on /setup-org or /onboarding to prevent loops)
 *   2. Has org but no blueprints → redirect to /onboarding
 *
 * IMPORTANT: redirect() calls must be OUTSIDE the try/catch that wraps auth().
 * In Next.js 14, redirect() throws an internal signal that is NOT an Error
 * instance — catching it and not re-throwing silently swallows the redirect.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SubscriptionBanner } from "@/components/access/SubscriptionBanner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Read current path to avoid redirect loops ─────────────────────────────
  const headersList = await headers();
  const pathname = headersList.get("x-invoke-path") ?? headersList.get("x-pathname") ?? "";
  const isOrgSetupPath = pathname === "/setup-org" || pathname === "/onboarding";

  // ── Read auth state — gracefully handle unavailable Clerk context ──────────
  let userId: string | null = null;
  let orgId: string | null = null;

  try {
    const authResult = await auth();
    userId = authResult.userId ?? null;
    orgId = authResult.orgId ?? null;
  } catch {
    // auth() threw — Clerk context unavailable (e.g. unauthenticated edge case).
    // Fall through: page-level SignedIn/SignedOut guards handle auth state.
  }

  // ── Guard 1: signed in but no organisation yet ────────────────────────────
  // redirect() is OUTSIDE the try/catch so its internal throw propagates.
  // Skip this guard on /setup-org and /onboarding to prevent redirect loops:
  // the JWT cookie may still be propagating after setActive().
  if (userId && !orgId && !isOrgSetupPath) {
    redirect("/setup-org");
  }

  // ── Guard 2: has org but no blueprints → onboarding ──────────────────────
  if (orgId) {
    const blueprintCount = await prisma.campaignBlueprint.count({
      where: { tenantId: orgId },
    });
    if (blueprintCount === 0) {
      redirect("/onboarding");
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* SubscriptionBanner handles its own state — layout does not need to know subscription status */}
      <SubscriptionBanner />
      {children}
    </div>
  );
}
