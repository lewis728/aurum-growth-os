/**
 * GET /api/cron/portfolio-check
 *
 * Runs the Chief of Staff (cross-portfolio) reasoning cycle once per agency
 * (unique tenantId). Scheduled every 6 hours via vercel.json.
 * Protected by CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runChiefOfStaffCycle } from "@/lib/agents/chiefOfStaff";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Unique tenants that have at least one blueprint.
  const rows = await prisma.campaignBlueprint.findMany({
    select:   { tenantId: true },
    distinct: ["tenantId"],
  });
  const tenantIds = rows.map(r => r.tenantId);

  if (tenantIds.length === 0) {
    return NextResponse.json({ processed: 0, timestamp: new Date().toISOString() });
  }

  const results = await Promise.allSettled(
    tenantIds.map(tenantId => runChiefOfStaffCycle(tenantId))
  );

  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) {
    console.error(`[cron/portfolio-check] ${failed}/${tenantIds.length} cycles failed`);
  }

  return NextResponse.json({
    processed: tenantIds.length,
    failed,
    timestamp: new Date().toISOString(),
  });
}
