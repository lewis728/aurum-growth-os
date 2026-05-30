/**
 * /api/clients/[blueprintId]/brief
 * GET — returns the ClientBrief for a blueprint (or an empty shell).
 * PUT — upserts the ClientBrief. Tenant-scoped: only the owning tenant can read/write.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// String fields accepted on PUT.
const STRING_FIELDS = [
  "idealCustomerProfile", "badLeadSignals", "qualificationQuestions", "brandTone",
  "keyUSPs", "competitorNames", "reportingPreferences", "complianceNotes",
  "websiteSummary", "clientContactName", "clientContactEmail", "clientWhatsApp",
] as const;

// Numeric fields accepted on PUT.
const NUMBER_FIELDS = [
  "averageClientValue", "budgetHardLimit", "approvalThreshold", "targetCplGbp",
] as const;

async function assertOwnership(blueprintId: string, tenantId: string): Promise<boolean> {
  const bp = await prisma.campaignBlueprint.findFirst({
    where:  { id: blueprintId, tenantId },
    select: { id: true },
  });
  return bp !== null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const { blueprintId } = params;
  if (!(await assertOwnership(blueprintId, tenantId))) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const brief = await prisma.clientBrief.findUnique({ where: { blueprintId } });
  return NextResponse.json({ brief });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const { blueprintId } = params;
  if (!(await assertOwnership(blueprintId, tenantId))) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Whitelist + coerce. Empty strings become null; invalid numbers are dropped.
  const data: Record<string, string | number | null | Prisma.InputJsonValue> = {};
  for (const f of STRING_FIELDS) {
    if (f in body) {
      const v = body[f];
      data[f] = typeof v === "string" && v.trim() ? v.trim() : null;
    }
  }
  for (const f of NUMBER_FIELDS) {
    if (f in body) {
      const v = body[f];
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
      data[f] = Number.isFinite(n) ? n : null;
    }
  }
  if ("objectionResponses" in body && body.objectionResponses != null) {
    data.objectionResponses = body.objectionResponses as Prisma.InputJsonValue;
  }

  const brief = await prisma.clientBrief.upsert({
    where:  { blueprintId },
    create: { blueprintId, tenantId, ...data },
    update: data,
  });

  return NextResponse.json({ brief });
}
