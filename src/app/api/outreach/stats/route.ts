/**
 * GET /api/outreach/stats
 * Tenant-scoped dashboard summary for the outreach engine: pipeline counts, recent
 * activity events, and A/B variant performance. Powers the "run it like a pro"
 * view without opening individual prospects.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { abReport } from "@/lib/outreach/abTuner";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [byStatus, byVerification, byGrade, total, withEmail, repliedTotal, booked7, replied7, events, ab] = await Promise.all([
    prisma.outreachProspect.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }).catch(() => []),
    prisma.outreachProspect.groupBy({ by: ["verificationStatus"], where: { tenantId }, _count: { _all: true } }).catch(() => []),
    prisma.outreachProspect.groupBy({ by: ["leadGrade"], where: { tenantId }, _count: { _all: true } }).catch(() => []),
    prisma.outreachProspect.count({ where: { tenantId } }).catch(() => 0),
    prisma.outreachProspect.count({ where: { tenantId, contactEmail: { not: null } } }).catch(() => 0),
    prisma.outreachProspect.count({ where: { tenantId, repliedAt: { not: null } } }).catch(() => 0),
    prisma.outreachProspect.count({ where: { tenantId, bookedAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.outreachProspect.count({ where: { tenantId, repliedAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.outreachEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 30 }).catch(() => []),
    abReport(tenantId),
  ]);

  const counts: Record<string, number> = {};
  for (const g of byStatus) counts[g.status] = g._count._all;
  const verification: Record<string, number> = {};
  for (const g of byVerification) verification[g.verificationStatus ?? "unchecked"] = g._count._all;
  const grades: Record<string, number> = {};
  for (const g of byGrade) grades[g.leadGrade ?? "ungraded"] = g._count._all;

  return NextResponse.json({
    total,
    withEmail,
    repliedTotal,
    counts,
    verification,   // valid | catch_all | risky | invalid | unknown | skipped | unchecked
    grades,         // A | B | C | D | ungraded
    bookedThisWeek: booked7,
    repliedThisWeek: replied7,
    abTest: ab,
    recentEvents: events.map((e) => ({ type: e.type, detail: e.detail, at: e.createdAt })),
  });
}
