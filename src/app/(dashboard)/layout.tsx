/**
 * src/app/(dashboard)/layout.tsx
 * Dashboard route group layout.
 *
 * Guard: has org but no AgencyProfile → re-key pending profile or redirect to /onboarding
 *
 * NOTE: Guard 1 (userId && !orgId → /setup-org) has been intentionally removed.
 * New users are routed to /setup-org by Clerk's afterSignUpUrl, not by this layout.
 * Guard 1 caused redirect loops when the JWT cookie hadn't propagated yet after setActive().
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

  // Guard: has org → must have AgencyProfile (re-key pending if needed)
  if (orgId) {
    let agencyProfile = await prisma.agencyProfile.findUnique({
      where: { tenantId: orgId },
      select: { id: true },
    });

    if (!agencyProfile && userId) {
      const pendingProfile = await prisma.agencyProfile.findUnique({
        where: { tenantId: `pending:${userId}` },
        select: { id: true },
      });

      if (pendingProfile) {
        await prisma.agencyProfile.update({
          where: { tenantId: `pending:${userId}` },
          data: { tenantId: orgId },
        });
        agencyProfile = pendingProfile;
        console.log(`[dashboard/layout] Re-keyed AgencyProfile pending:${userId} → ${orgId}`);
      }
    }

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
