import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const tenantId = orgId ?? `pending:${userId}`;

  const blueprints = await prisma.campaignBlueprint.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  if (blueprints.length === 0) {
    return NextResponse.json({ clients: [] });
  }

  const blueprintIds = blueprints.map((b) => b.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [weeklyLeadGroups, latestLeadGroups] = await Promise.all([
    prisma.lead.groupBy({
      by: ["blueprintId"],
      where: { blueprintId: { in: blueprintIds }, createdAt: { gte: sevenDaysAgo } },
      _count: { id: true },
    }),
    prisma.lead.groupBy({
      by: ["blueprintId"],
      where: { blueprintId: { in: blueprintIds } },
      _max: { createdAt: true },
    }),
  ]);

  const weeklyCountMap = new Map<string, number>();
  for (const g of weeklyLeadGroups) {
    if (g.blueprintId) weeklyCountMap.set(g.blueprintId, g._count.id);
  }

  const lastLeadAtMap = new Map<string, string | null>();
  for (const g of latestLeadGroups) {
    if (g.blueprintId) {
      lastLeadAtMap.set(g.blueprintId, g._max.createdAt?.toISOString() ?? null);
    }
  }

  const clients = blueprints.map((b) => {
    const row = b as Record<string, unknown>;
    return {
      id: b.id,
      businessName: String(row.businessName ?? row.businessDescription ?? "Client"),
      vertical: String(row.vertical ?? row.serviceIntent ?? "General"),
      status: (String(row.status ?? "setup")) as "live" | "paused" | "pending" | "setup",
      spendToday: 0,
      leadsThisWeek: weeklyCountMap.get(b.id) ?? 0,
      cpl: null as number | null,
      lastLeadAt: lastLeadAtMap.get(b.id) ?? null,
    };
  });

  return NextResponse.json({ clients });
}
