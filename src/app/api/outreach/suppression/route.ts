/**
 * /api/outreach/suppression
 * GET  — list the tenant's do-not-contact entries (newest first).
 * POST — manually add an email to the permanent suppression list.
 * Tenant-scoped (Clerk). Bounces/complaints are added automatically elsewhere;
 * this is the manual + review surface.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { suppress } from "@/lib/outreach/suppression";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const entries = await prisma.outreachSuppression.findMany({
    where: { tenantId }, orderBy: { createdAt: "desc" }, take: 500,
    select: { id: true, email: true, domain: true, reason: true, createdAt: true },
  }).catch(() => []);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { email?: unknown; reason?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "manual";

  await suppress(tenantId, email, reason);
  // Also close any matching prospect so it leaves the active pipeline.
  await prisma.outreachProspect.updateMany({
    where: { tenantId, contactEmail: { equals: email, mode: "insensitive" } },
    data:  { status: "closed", unsubscribed: true },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
