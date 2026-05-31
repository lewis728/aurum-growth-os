/**
 * GET   /api/outreach/prospects/[id] — one prospect + its email sequence.
 * PATCH /api/outreach/prospects/[id] — update status / notes / booked date.
 * Tenant-scoped.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set(["pending", "qualifying", "rejected", "errored", "review", "generated", "emailing", "replied", "booked", "dormant", "closed"]);

async function owns(id: string, tenantId: string): Promise<boolean> {
  const p = await prisma.outreachProspect.findFirst({ where: { id, tenantId }, select: { id: true } });
  return p !== null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const prospect = await prisma.outreachProspect.findFirst({
    where:   { id: params.id, tenantId },
    include: { sequences: { orderBy: { emailNumber: "asc" } } },
  });
  if (!prospect) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ prospect });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  if (!(await owns(params.id, tenantId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const data: { status?: string; notes?: string | null; bookedAt?: Date | null; repliedAt?: Date | null } = {};

  if ("status" in body) {
    const s = typeof body.status === "string" ? body.status : "";
    if (!ALLOWED_STATUS.has(s)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    data.status = s;
    // Convenience stamps when moving to a milestone status.
    if (s === "booked") data.bookedAt = new Date();
    if (s === "replied") data.repliedAt = new Date();
  }
  if ("notes" in body) data.notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : null;
  if ("bookedAt" in body) data.bookedAt = body.bookedAt ? new Date(String(body.bookedAt)) : null;

  const prospect = await prisma.outreachProspect.update({ where: { id: params.id }, data });
  return NextResponse.json({ prospect });
}
