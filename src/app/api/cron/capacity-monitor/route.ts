/**
 * GET /api/cron/capacity-monitor  (Layer 7 — Part 8)
 * Every 2 hours: for each LIVE blueprint, match ad spend to calendar capacity,
 * run flash campaigns on fresh cancellations, and fire the day-25 retainer report.
 * Auth: Bearer CRON_SECRET. Bounded concurrency + per-item isolation (never aborts
 * the batch). Fail-safe throughout.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runCapacityCheck, runFlashCampaign, maybeRunDay25Report } from "@/lib/intelligence/capacityMonitor";
import { mapPool } from "@/lib/utils/concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const CONCURRENCY = 8;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blueprints = await prisma.campaignBlueprint
    .findMany({ where: { status: "live" }, select: { id: true, tenantId: true } })
    .catch(() => [] as { id: string; tenantId: string }[]);

  if (blueprints.length === 0) {
    return NextResponse.json({ checked: 0, throttled: 0, flashed: 0, reports: 0, timestamp: new Date().toISOString() });
  }

  let throttled = 0, flashed = 0, reports = 0;
  const results = await mapPool(blueprints, CONCURRENCY, async (bp) => {
    const cap = await runCapacityCheck(bp.id, bp.tenantId);
    if (cap.action !== "maintain" && cap.action !== "skipped" && cap.action !== "error") throttled++;
    const flash = await runFlashCampaign(bp.id, bp.tenantId);
    if (flash.contacted > 0) flashed++;
    const report = await maybeRunDay25Report(bp.id, bp.tenantId);
    if (report) reports++;
  });

  const failed = results.filter((r) => r.status === "rejected").length;
  return NextResponse.json({
    checked: blueprints.length, throttled, flashed, reports, failed, timestamp: new Date().toISOString(),
  });
}
