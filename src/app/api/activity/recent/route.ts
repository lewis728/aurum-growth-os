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

  const items = leads.map((l) => ({
    type: "lead" as const,
    title: "New lead",
    description: `${`${l.firstName} ${l.lastName}`.trim()} submitted a form`,
    createdAt: String(l.createdAt),
  }));

  return NextResponse.json({ items });
}
