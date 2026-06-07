/**
 * GET /api/admin/territories — God Mode "Territories" data.
 * Per city + vertical: the contractors (name/status), revenue (£700 lock-ins that
 * cleared + £350 paid survey charges), confirmed bookings, and failed charges that
 * need attention. Tenant-scoped via the standard auth() pattern.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Territory {
  city: string;
  vertical: string;
  contractors: { name: string; status: string; priority: number }[];
  revenueGbp: number;
  bookings: number;
  failedCharges: number;
  activeCount: number;
}

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const [contractors, charges] = await Promise.all([
    prisma.contractor.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        city: true,
        vertical: true,
        status: true,
        priority: true,
        lockInFeeGbp: true,
        lockInPaidAt: true,
      },
      orderBy: [{ city: "asc" }, { priority: "asc" }],
    }),
    prisma.surveyCharge.findMany({
      where: { tenantId },
      select: { contractorId: true, amountGbp: true, kind: true, status: true },
    }),
  ]);

  const byContractor = new Map<string, { paidRevenue: number; bookings: number; failed: number }>();
  for (const ch of charges) {
    const agg = byContractor.get(ch.contractorId) ?? { paidRevenue: 0, bookings: 0, failed: 0 };
    if (ch.status === "paid" || ch.status === "credit_consumed") {
      agg.bookings += 1;
      if (ch.status === "paid" && ch.kind === "charge") agg.paidRevenue += ch.amountGbp;
    } else if (ch.status === "failed") {
      agg.failed += 1;
    }
    byContractor.set(ch.contractorId, agg);
  }

  const map = new Map<string, Territory>();
  for (const c of contractors) {
    const key = `${c.city.toLowerCase()}|${c.vertical}`;
    const t =
      map.get(key) ??
      { city: c.city, vertical: c.vertical, contractors: [], revenueGbp: 0, bookings: 0, failedCharges: 0, activeCount: 0 };
    t.contractors.push({ name: c.name, status: c.status, priority: c.priority });
    if (c.status === "active") t.activeCount += 1;
    if (c.lockInPaidAt) t.revenueGbp += c.lockInFeeGbp;
    const agg = byContractor.get(c.id);
    if (agg) {
      t.revenueGbp += agg.paidRevenue;
      t.bookings += agg.bookings;
      t.failedCharges += agg.failed;
    }
    map.set(key, t);
  }

  const territories = Array.from(map.values()).sort((a, b) => b.revenueGbp - a.revenueGbp);
  return NextResponse.json({ territories });
}
