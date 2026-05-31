/**
 * GET /api/cron/vector-knowledge
 *
 * Nightly (02:00) cross-tenant intelligence pass (Sprint 10F): for each LIVE
 * blueprint, adapt the best winning psychological pattern in its vertical to that
 * client's offer + location and add it to the creative queue. CRON_SECRET-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adaptPatternsForClient } from "@/lib/services/vectorKnowledgeService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    return NextResponse.json({ adapted: 0, skipped: 0, timestamp: new Date().toISOString() });
  }

  const results = await Promise.allSettled(
    blueprints.map((bp) => adaptPatternsForClient(bp.id, bp.tenantId)),
  );

  let adapted = 0, skipped = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) adapted++;
    else skipped++;
  }

  return NextResponse.json({ adapted, skipped, timestamp: new Date().toISOString() });
}
