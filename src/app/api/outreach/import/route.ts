/**
 * POST /api/outreach/import
 * Bulk import from an Apollo CSV. Accepts raw CSV in the request body (text/plain
 * or { csv } JSON). Parses, dedupes by domain, creates OutreachProspect rows in
 * status "pending". Generation is a separate step (batch or per-row) so a large
 * import returns instantly. Tenant-scoped.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { parseApolloCsv, importProspects } from "@/lib/outreach/prospectImporter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // Accept either raw CSV text or a JSON { csv, vertical } body.
  const contentType = req.headers.get("content-type") ?? "";
  let csv = "";
  let vertical = "aesthetics";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { csv?: string; vertical?: string };
      csv = typeof body.csv === "string" ? body.csv : "";
      if (typeof body.vertical === "string" && body.vertical.trim()) vertical = body.vertical.trim();
    } else {
      csv = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Could not read CSV body" }, { status: 400 });
  }

  const rows = parseApolloCsv(csv);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found. Expect headers: First Name, Last Name, Company, Website, City, Email." }, { status: 400 });
  }

  const result = await importProspects(tenantId, rows, vertical);
  return NextResponse.json({ ...result, parsed: rows.length });
}
