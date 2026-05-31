/**
 * GET /api/billing/status
 * Subscription + tiered per-client seat breakdown for the billing UI.
 * Seat counts are derived from billable CampaignBlueprints (live | paused),
 * grouped by clientTier — the authoritative source of truth.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  getSubscriptionStatus,
  isPlatformActive,
  computeMonthlyTotal,
  computeVolumePricing,
  PRICING,
} from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  const status = await getSubscriptionStatus(tenantId);

  // Billable clients are live or paused (not pending / archived).
  const clients = await prisma.campaignBlueprint.findMany({
    where:   { tenantId, status: { in: ["live", "paused"] } },
    select:  { id: true, businessName: true, clientTier: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  const starterSeats     = clients.filter(c => c.clientTier === "starter").length;
  const fullServiceSeats = clients.filter(c => c.clientTier !== "starter").length;
  const monthlyTotal     = computeMonthlyTotal(starterSeats, fullServiceSeats);

  // Volume pricing (Sprint 11) — priced by TOTAL billable client count.
  const volume = computeVolumePricing(clients.length);

  return NextResponse.json({
    platformActive:  isPlatformActive(status),
    subscribed:      status ? (status.status === "active" || status.status === "trialing") : false,
    status:          status?.status ?? null,
    platformFee:     PRICING.platform,
    starterSeats,
    fullServiceSeats,
    seatPrices:      { starter: PRICING.starter, full_service: PRICING.full_service },
    monthlyTotal,
    volume,
    nextBillingDate: status?.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt:     status?.trialEndsAt?.toISOString() ?? null,
    clients,
  });
}
