/**
 * GET /api/cron/auction-arbitrage  (Layer 8 — Part 9)
 * Every 6 hours: snapshot each LIVE blueprint's CPM, compute the 14-day index,
 * apply CPM-spike protection, then per-tenant build a portfolio rebalance +
 * outreach-domain allocation recommendation. Auth: Bearer CRON_SECRET.
 * Bounded concurrency, per-item isolation, fail-safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { snapshotBlueprintCpm, applyAllocationForTenant, type ArbitrageReading } from "@/lib/intelligence/auctionArbitrage";
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
    return NextResponse.json({ snapshotted: 0, tenants: 0, timestamp: new Date().toISOString() });
  }

  // Snapshot CPMs (bounded concurrency, isolated).
  const settled = await mapPool(blueprints, CONCURRENCY, (bp) => snapshotBlueprintCpm(bp.id, bp.tenantId));
  const readings: ArbitrageReading[] = settled
    .filter((s): s is { status: "fulfilled"; value: ArbitrageReading } => s.status === "fulfilled" && s.value !== null)
    .map((s) => s.value);

  // Group readings by tenant → apply allocation/rebalance per tenant.
  const byTenant = new Map<string, ArbitrageReading[]>();
  for (const bp of blueprints) byTenant.set(bp.tenantId, byTenant.get(bp.tenantId) ?? []);
  for (const r of readings) {
    const bp = blueprints.find((b) => b.id === r.blueprintId);
    if (bp) byTenant.get(bp.tenantId)?.push(r);
  }
  await mapPool(Array.from(byTenant.entries()), 4, ([tenantId, rs]) => applyAllocationForTenant(tenantId, rs));

  const protectedCount = readings.filter((r) => r.action.startsWith("CPM spike")).length;
  return NextResponse.json({
    snapshotted: readings.length, tenants: byTenant.size, protected: protectedCount, timestamp: new Date().toISOString(),
  });
}
