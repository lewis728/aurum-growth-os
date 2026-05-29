/**
 * src/app/api/auth/link-org/route.ts
 * POST /api/auth/link-org
 *
 * Called by /setup-org after setActive() resolves and orgId is confirmed in useAuth().
 * Links any AgencyProfile saved with a pending:userId key to the real orgId.
 *
 * This handles the race condition where the onboarding chat completes before
 * the Clerk JWT cookie has propagated the new orgId.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function POST(): Promise<NextResponse> {
  const { userId, orgId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!orgId) {
    return NextResponse.json(
      { error: "No orgId in session — call setActive() first" },
      { status: 400 }
    );
  }

  const pendingKey = `pending:${userId}`;

  // Check if there's a pending AgencyProfile to link
  const pendingProfile = await prisma.agencyProfile.findUnique({
    where: { tenantId: pendingKey },
  });

  if (!pendingProfile) {
    // No pending profile — check if already linked
    const existing = await prisma.agencyProfile.findUnique({
      where: { tenantId: orgId },
    });
    return NextResponse.json({
      linked: false,
      alreadyLinked: !!existing,
      message: existing
        ? "AgencyProfile already linked to orgId"
        : "No pending profile found",
    });
  }

  // Re-key the pending profile to the real orgId
  try {
    await prisma.$transaction([
      // Create the properly-keyed profile
      prisma.agencyProfile.upsert({
        where: { tenantId: orgId },
        create: {
          tenantId: orgId,
          agencyName: pendingProfile.agencyName,
          niches: pendingProfile.niches,
          currentClientCount: pendingProfile.currentClientCount,
          currentFulfilment: pendingProfile.currentFulfilment,
          primaryGoal: pendingProfile.primaryGoal,
          onboardedAt: pendingProfile.onboardedAt,
        },
        update: {
          agencyName: pendingProfile.agencyName,
          niches: pendingProfile.niches,
          currentClientCount: pendingProfile.currentClientCount,
          currentFulfilment: pendingProfile.currentFulfilment,
          primaryGoal: pendingProfile.primaryGoal,
        },
      }),
      // Delete the pending placeholder
      prisma.agencyProfile.delete({
        where: { tenantId: pendingKey },
      }),
    ]);

    console.log(
      `[link-org] Linked AgencyProfile from pending:${userId} → ${orgId}`
    );

    return NextResponse.json({
      linked: true,
      orgId,
      agencyName: pendingProfile.agencyName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[link-org] Failed to link profile:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
