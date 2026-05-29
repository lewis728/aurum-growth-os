/**
 * GET /api/reports/[reportId]
 * Returns the full MonthlyReport including reportHtml for the authenticated agency owner.
 *
 * Auth:  Clerk (getTenantId)
 * Guard: tenantId must match report.tenantId (403 if not)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuth, getServerTenantId } from "@/lib/serverAuth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { reportId: string } }
): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = await getServerTenantId(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reportId } = params;

  // ── Fetch report ──────────────────────────────────────────────────────────
  const report = await prisma.monthlyReport.findUnique({
    where: { id: reportId },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // ── Tenant isolation ──────────────────────────────────────────────────────
  if (report.tenantId !== tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    id:          report.id,
    month:       report.month,
    year:        report.year,
    reportHtml:  report.reportHtml,
    reportData:  report.reportData,
    generatedAt: report.generatedAt,
    emailedAt:   report.emailedAt,
  });
}
