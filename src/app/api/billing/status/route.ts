/**
 * GET /api/billing/status
 * Returns the tenant's subscription status without exposing Stripe IDs.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerAuth, getServerTenantId } from "@/lib/serverAuth";
import { getSubscriptionStatus } from "@/lib/services/stripeService";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await getServerAuth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tenantId = await getServerTenantId(req);
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[billing/status]", msg);
    if (msg.includes("UNAUTHORIZED") || msg.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: msg, step: "catch" }, { status: 500 });
  }
}
