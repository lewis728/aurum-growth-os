/**
 * GET /api/cron/spend-fee
 * Monthly cron job — runs on the 1st of each month at 08:00 UTC.
 * Calculates 5% ad spend management fee for all tenants with active subscriptions
 * and creates Stripe invoices.
 *
 * Protected by CRON_SECRET header (set in vercel.json).
 * Idempotent — SpendFeeRecord @@unique([tenantId, periodMonth]) prevents double-charging.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { calculateAndCreateSpendFee } from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

function getPeriodMonth(): string {
  // Run on the 1st — bill for the PREVIOUS month
  const now = new Date();
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const periodMonth = getPeriodMonth();
  console.info(`[cron/spend-fee] Starting spend fee calculation for period=${periodMonth}`);

  // Fetch all tenants with active or trialing subscriptions
  const subscriptions = await prisma.agencySubscription.findMany({
    where: { status: { in: ["active", "trialing"] } },
    select: { tenantId: true },
  });

  if (subscriptions.length === 0) {
    console.info("[cron/spend-fee] No active subscriptions found");
    return NextResponse.json({ processed: 0, period: periodMonth });
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const sub of subscriptions) {
    try {
      await calculateAndCreateSpendFee(sub.tenantId, periodMonth);
      processed++;
    } catch (err: unknown) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${sub.tenantId}: ${message}`);
      console.error(`[cron/spend-fee] Failed for tenantId=${sub.tenantId}: ${message}`);
    }
  }

  console.info(`[cron/spend-fee] Complete. processed=${processed} failed=${failed} period=${periodMonth}`);

  return NextResponse.json({
    period: periodMonth,
    total: subscriptions.length,
    processed,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
