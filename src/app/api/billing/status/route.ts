/**
 * GET /api/billing/status
 * Returns the tenant's subscription status without exposing Stripe IDs.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getTenantId } from "@/lib/auth";
import { getSubscriptionStatus } from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "No organisation found" }, { status: 400 });
  }

  const status = await getSubscriptionStatus(tenantId);

  if (!status) {
    return NextResponse.json({
      subscribed: false,
      status: null,
      seatCount: 0,
      trialEndsAt: null,
      currentPeriodEnd: null,
    });
  }

  return NextResponse.json({
    subscribed: status.status === "active" || status.status === "trialing",
    status: status.status,
    seatCount: status.seatCount,
    trialEndsAt: status.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: status.currentPeriodEnd?.toISOString() ?? null,
  });
}
