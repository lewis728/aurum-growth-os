/**
 * GET /api/cron/nightly-learning
 *
 * Kai's nightly run (Sprint 6). For every LIVE blueprint, distil the last 30 days
 * of outcomes into ≤15 sharp client-specific facts (ClientBrief.distilledLearnings),
 * which every role reads at the start of every cycle.
 *
 * Scheduled at 00:00 daily via vercel.json. Protected by CRON_SECRET.
 * Always returns 200 — a cron endpoint never fails the caller.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runLearnerCycle } from "@/lib/agents/roles/learner";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — enough for all live blueprints

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blueprints = await prisma.campaignBlueprint.findMany({
    where:  { status: "live" },
    select: { id: true, tenantId: true },
  });

  if (blueprints.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, failed: 0, timestamp: new Date().toISOString() });
  }

  const results = await Promise.allSettled(
    blueprints.map((bp) => runLearnerCycle(bp.id, bp.tenantId)),
  );

  let updated = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") { failed++; continue; }
    if (r.value.status === "updated") updated++;
    else if (r.value.status === "error") failed++;
    else skipped++; // skipped_no_data | skipped_no_openai
  }

  if (failed > 0) console.error(`[cron/nightly-learning] ${failed}/${blueprints.length} learner cycles failed`);

  return NextResponse.json({ updated, skipped, failed, timestamp: new Date().toISOString() });
}
