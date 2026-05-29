/**
 * GET /api/reports
 * Returns a paginated list of MonthlyReport records for the authenticated agency owner.
 * reportHtml is excluded from the list response (too large — fetch via /api/reports/[id]).
 *
 * Query params:
 *   ?limit=12  (default 12, max 24)
 *   ?offset=0  (default 0)
 *
 * Auth:  Clerk (getTenantId)
 * Guard: validateStripeMandate — 402 if no active subscription
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { validateStripeMandate } from "@/lib/services/stripeService";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Subscription mandate ──────────────────────────────────────────────────
  const mandateOk = await validateStripeMandate(tenantId);
  if (!mandateOk) {
    return NextResponse.json({ error: "Subscription required" }, { status: 402 });
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  const url    = req.nextUrl;
  const limit  = Math.min(parseInt(url.searchParams.get("limit")  ?? "12", 10), 24);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0",  10), 0);

  const reports = await prisma.monthlyReport.findMany({
    where:   { tenantId },
    select: {
      id:          true,
      month:       true,
      year:        true,
      generatedAt: true,
      emailedAt:   true,
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take:    limit,
    skip:    offset,
  });

  const total = await prisma.monthlyReport.count({ where: { tenantId } });

  return NextResponse.json({ reports, total, limit, offset });
}
