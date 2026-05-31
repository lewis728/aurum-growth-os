/**
 * /api/prospects/research  (Sprint 17 — Prospect Research)
 * POST — runs research for a prospect (scrape + Meta ads + GPT-4o 90-day proposal).
 * GET  — lists this tenant's prior research, newest first.
 * Tenant-scoped via the standard Clerk pattern.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runProspectResearch, listProspectResearch } from "@/lib/services/prospectResearchService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const items = await listProspectResearch(tenantId);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const websiteUrl  = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  const location    = typeof body.location === "string" ? body.location.trim() : undefined;

  if (!companyName || !websiteUrl) {
    return NextResponse.json({ error: "Company name and website URL are required." }, { status: 400 });
  }

  const result = await runProspectResearch(tenantId, { companyName, websiteUrl, location });
  return NextResponse.json({ research: result });
}
