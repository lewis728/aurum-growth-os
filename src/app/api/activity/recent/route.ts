import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const tenantId = orgId ?? `pending:${userId}`;

  const leads = await prisma.lead.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 10,
  }).catch(() => []);

  const items = leads.map((l: Record<string, unknown>) => ({
    type: "lead",
    title: "New lead",
    description: `${(l.fullName as string) ?? "Unknown"} submitted a form`,
    createdAt: l.createdAt,
  }));

  return NextResponse.json({ items });
}
