/**
 * GET /api/cron/morning-briefing
 *
 * Runs the REPORTER role (Ava) for every LIVE blueprint each morning: generates
 * the first-person morning briefing, detects at-risk clients (→ Slack), and logs
 * booking milestones. Scheduled at 06:00 daily via vercel.json.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runReporterCycle } from "@/lib/agents/roles/reporter";

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
    return NextResponse.json({ generated: 0, atRisk: 0, milestones: 0, failed: 0, timestamp: new Date().toISOString() });
  }

  // ── Run the reporter for each (settle all, never throw) ────────────────────
  const results = await Promise.allSettled(
    blueprints.map((bp) => runReporterCycle(bp.id, bp.tenantId)),
  );

  let generated = 0, atRisk = 0, milestones = 0, failed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") { failed++; continue; }
    if (r.value.briefing) generated++; else failed++;
    if (r.value.atRisk) atRisk++;
    if (r.value.milestone !== null) milestones++;
  }

  if (failed > 0) {
    console.error(`[cron/morning-briefing] ${failed}/${blueprints.length} reporter cycles had no briefing`);
  }

  return NextResponse.json({ generated, atRisk, milestones, failed, timestamp: new Date().toISOString() });
}
