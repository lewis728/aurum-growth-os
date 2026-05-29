/**
 * src/app/(dashboard)/layout.tsx
 * Dashboard route group layout.
 *
 * Guard: no AgencyProfile found for this user → redirect to /onboarding
 *
 * Lookup order:
 *   1. By orgId (JWT has org)
 *   2. By pending:userId (org not yet in JWT — re-key to orgId if possible)
 *   3. Not found → redirect to /onboarding
 *
 * NOTE: Guard 1 (userId && !orgId → /setup-org) has been intentionally removed.
 * New users are routed to /setup-org by Clerk's afterSignUpUrl.
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
  let userId: string | null = null;
  let orgId: string | null = null;

  try {
    const authResult = await auth();
    userId = authResult.userId ?? null;
    orgId = authResult.orgId ?? null;
  } catch {
    // Clerk context unavailable — page-level guards handle auth
  }

  // Guard: must have a valid AgencyProfile to access the dashboard
  if (userId) {
    let agencyProfile: { id: string } | null = null;

    // 1. Try lookup by orgId (happy path — JWT has org)
    if (orgId) {
      agencyProfile = await prisma.agencyProfile.findUnique({
        where: { tenantId: orgId },
        select: { id: true },
      });
    }

    // 2. Try lookup by pending:userId (JWT missing org — common after onboarding)
    if (!agencyProfile) {
      const pendingProfile = await prisma.agencyProfile.findUnique({
        where: { tenantId: `pending:${userId}` },
        select: { id: true },
      });

      if (pendingProfile) {
        if (orgId) {
          // Re-key now that we have orgId
          await prisma.agencyProfile.update({
            where: { tenantId: `pending:${userId}` },
            data: { tenantId: orgId },
          });
          console.log(`[dashboard/layout] Re-keyed AgencyProfile pending:${userId} → ${orgId}`);
        }
        // Accept the pending profile — user has completed onboarding
        agencyProfile = pendingProfile;
      }
    }

    // 3. No profile found → send to onboarding
    if (!agencyProfile) {
      redirect("/onboarding");
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <SubscriptionBanner />
      {children}
    </div>
  );
}
