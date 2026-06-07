/**
 * POST /api/contractors/[id]/lock-in
 *
 * Returns a Stripe Checkout URL for the contractor's £700 lock-in payment, which
 * saves their card (off-session) and pre-pays the first 2 site surveys. The Stripe
 * webhook grants the prepaid credits on completion. Tenant-scoped; blocks if the
 * contractor is already locked in.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { startContractorLockIn } from "@/lib/services/contractorBillingService";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // Tenant isolation: only operate on a contractor owned by this tenant.
  const contractor = await prisma.contractor.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true, lockInPaidAt: true },
  });
  if (!contractor) return NextResponse.json({ error: "Contractor not found" }, { status: 404 });
  if (contractor.lockInPaidAt) {
    return NextResponse.json({ error: "Contractor is already locked in" }, { status: 409 });
  }

  const origin = req.nextUrl.origin;
  try {
    const url = await startContractorLockIn(contractor.id, {
      successUrl: `${origin}/?contractor_locked_in=${contractor.id}`,
      cancelUrl: `${origin}/?contractor_lockin_cancelled=${contractor.id}`,
    });
    return NextResponse.json({ url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[contractors/lock-in] failed:", message);
    return NextResponse.json({ error: "Could not start lock-in payment" }, { status: 500 });
  }
}
