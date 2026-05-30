/**
 * POST /api/billing/portal
 * Creates a Stripe Customer Portal session for managing subscription.
 * Returns { url } — frontend opens in a new tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBillingPortalSession } from "@/lib/services/stripeService";
import { auth } from "@clerk/nextjs/server";
import { isOwner } from "@/lib/access/roles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!(await isOwner())) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  const tenantId = orgId;
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
