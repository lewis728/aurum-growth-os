/**
 * POST /api/billing/portal
 * Creates a Stripe Customer Portal session for managing subscription.
 * Returns { url } — frontend opens in a new tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerAuth, getServerTenantId } from "@/lib/serverAuth";
import { prisma } from "@/lib/prisma";
import { createBillingPortalSession } from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await getServerAuth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getServerTenantId(req);
  if (!tenantId) {
    return NextResponse.json({ error: "No organisation found" }, { status: 400 });
  }

  const sub = await prisma.agencySubscription.findUnique({ where: { tenantId } });
  if (!sub) {
    return NextResponse.json({ error: "No subscription found — please subscribe first" }, { status: 404 });
  }

  try {
    const origin = req.headers.get("origin") ?? "https://aurumgrowth.ai";
    const returnUrl = `${origin}/billing`;

    const url = await createBillingPortalSession(sub.stripeCustomerId, returnUrl);
    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/portal] Error:", message);
    return NextResponse.json({ error: "Failed to create portal session" }, { status: 500 });
  }
}
