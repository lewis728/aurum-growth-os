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

  const clients = blueprints.map((b) => ({
    id: b.id,
    businessName: (b as Record<string, unknown>).businessName as string ?? (b as Record<string, unknown>).businessDescription as string ?? "Client",
    vertical: (b as Record<string, unknown>).vertical as string ?? (b as Record<string, unknown>).serviceIntent as string ?? "General",
    status: ((b as Record<string, unknown>).status as string ?? "setup") as "live" | "paused" | "pending" | "setup",
    spendToday: 0,
    leadsThisWeek: 0,
    cpl: null,
    lastLeadAt: null,
  }));

  return NextResponse.json({ clients });
}
