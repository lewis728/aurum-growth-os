/**
 * GET /api/cron/morning-briefing
 *
 * Generates a fresh first-person morning briefing for every LIVE blueprint.
 * Scheduled at 06:00 daily via vercel.json cron.
 * Protected by CRON_SECRET — Vercel injects this automatically for cron routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateMorningBriefing } from "@/lib/services/morningBriefingService";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — enough for all live blueprints

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth: verify Vercel cron secret ──────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Fetch all live blueprints ─────────────────────────────────────────────
  const blueprints = await prisma.campaignBlueprint.findMany({
    where:  { status: "live" },
    select: { id: true, tenantId: true },
  });

  if (blueprints.length === 0) {
    return NextResponse.json({
      generated: 0,
      failed:    0,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Generate for each (settle all, never throw) ───────────────────────────
  const results = await Promise.allSettled(
    blueprints.map(bp => generateMorningBriefing(bp.id, bp.tenantId))
  );

  // A briefing "failed" if the promise rejected OR resolved to null.
  const generated = results.filter(r => r.status === "fulfilled" && r.value !== null).length;
  const failed    = blueprints.length - generated;

  if (failed > 0) {
    console.error(`[cron/morning-briefing] ${failed}/${blueprints.length} briefings failed`);
  }

  return NextResponse.json({
    generated,
    failed,
    timestamp: new Date().toISOString(),
  });
}
