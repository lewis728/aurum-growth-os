/**
 * src/app/api/cron/competitor-intel/route.ts
 * Weekly cron — Friday 05:00, just before the 06:00 morning briefing so the
 * Friday briefing folds in fresh competitor intel (Sprint 15).
 * Auth: Bearer CRON_SECRET. Fail-safe per client (runCompetitorScan never throws).
 */

import { NextRequest, NextResponse } from "next/server";
import { runCompetitorScanAllLive } from "@/lib/services/competitorIntelService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runCompetitorScanAllLive();
  const scanned = results.filter((r) => r.ok).length;
  const withAds = results.filter((r) => r.snapshot?.usedAdLibrary).length;

  return NextResponse.json(
    { scanned, failed: results.length - scanned, withAds, total: results.length },
    { status: 200 },
  );
}
