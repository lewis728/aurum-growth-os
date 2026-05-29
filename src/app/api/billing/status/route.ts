/**
 * GET /api/billing/status
 * Returns the tenant's subscription status without exposing Stripe IDs.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionStatus } from "@/lib/services/stripeService";
import { auth } from "@clerk/nextjs/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { orgId } = await auth();
    console.log('[billing/status] orgId from auth():', orgId);
    if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const tenantId = orgId;
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[billing/status]", msg);
    if (msg.includes("UNAUTHORIZED") || msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: msg, step: "catch" }, { status: 500 });
  }
}
