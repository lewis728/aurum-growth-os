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

  const clients = blueprints.map((b) => {
    const row = b as Record<string, unknown>;
    return {
      id: b.id,
      businessName: String(row.businessName ?? row.businessDescription ?? "Client"),
      vertical: String(row.vertical ?? row.serviceIntent ?? "General"),
      status: (String(row.status ?? "setup")) as "live" | "paused" | "pending" | "setup",
      spendToday: 0,
      leadsThisWeek: 0,
      cpl: null as number | null,
      lastLeadAt: null as string | null,
    };
  });

  return NextResponse.json({ clients });
}
