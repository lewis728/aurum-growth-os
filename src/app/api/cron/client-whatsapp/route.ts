/**
 * GET /api/cron/client-whatsapp
 *
 * Weekly client WhatsApp update (Sprint 10). For every LIVE blueprint with a
 * client WhatsApp number, generate + send a short results update under the
 * agency's brand. Scheduled Monday 09:00 via vercel.json. CRON_SECRET-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWeeklyClientUpdate } from "@/lib/services/clientUpdateService";

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
    return NextResponse.json({ sent: 0, skipped: 0, failed: 0, timestamp: new Date().toISOString() });
  }

  const results = await Promise.allSettled(
    blueprints.map((bp) => generateWeeklyClientUpdate(bp.id, bp.tenantId)),
  );

  let sent = 0, skipped = 0, failed = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") { failed++; continue; }
    if (r.value.status === "sent") sent++;
    else if (r.value.status === "error") failed++;
    else skipped++;
  }

  if (failed > 0) console.error(`[cron/client-whatsapp] ${failed}/${blueprints.length} weekly updates failed`);

  return NextResponse.json({ sent, skipped, failed, timestamp: new Date().toISOString() });
}
