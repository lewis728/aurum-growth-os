/**
 * GET /api/cron/agent-reasoning
 *
 * Runs the autonomous agent reasoning loop across all live blueprints.
 * Scheduled every 4 hours via vercel.json cron.
 * Protected by CRON_SECRET — Vercel injects this automatically for cron routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAgentReasoningCycle } from "@/lib/services/agentReasoningService";
import { mapPool } from "@/lib/utils/concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — enough for all live blueprints
// Bounded fan-out: at 1000+ clients, running every cycle at once would exhaust the
// DB pool + hit GPT rate limits. Process in capped-concurrency waves instead.
const CONCURRENCY = 10;

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
      processed: 0,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Run reasoning cycle for each blueprint (bounded concurrency, never throw) ──
  const results = await mapPool(blueprints, CONCURRENCY, (bp) => runAgentReasoningCycle(bp.id, bp.tenantId));

  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) {
    console.error(`[cron/agent-reasoning] ${failed}/${blueprints.length} cycles failed`);
  }

  return NextResponse.json({
    processed: blueprints.length,
    failed,
    timestamp: new Date().toISOString(),
  });
}
