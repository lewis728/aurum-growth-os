/**
 * GET /api/outreach/messages
 * The "store all the emails" view. Returns the OutreachMessage history for the
 * tenant — every email sent and every reply received — newest first. Tenant-scoped.
 *
 * Query params:
 *   ?prospectId=<id>  → just that clinic's thread (chronological)
 *   ?direction=outbound|inbound
 *   ?limit=<n>        → default 100, max 500
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const sp = new URL(req.url).searchParams;
  const prospectId = sp.get("prospectId");
  const direction = sp.get("direction");
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));

  const where: Prisma.OutreachMessageWhereInput = { tenantId };
  if (prospectId) where.prospectId = prospectId;
  if (direction === "outbound" || direction === "inbound") where.direction = direction;

  // A single prospect's thread reads best chronologically; the global feed newest-first.
  const messages = await prisma.outreachMessage.findMany({
    where,
    orderBy: { createdAt: prospectId ? "asc" : "desc" },
    take: limit,
    select: {
      id: true, prospectId: true, direction: true, channel: true, emailNumber: true,
      subject: true, body: true, status: true, createdAt: true,
    },
  }).catch(() => []);

  return NextResponse.json({ messages });
}
