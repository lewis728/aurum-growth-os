/**
 * src/app/api/leads/[leadId]/convert/route.ts
 * POST /api/leads/{leadId}/convert   body: { dealValue?: number }
 *
 * The one EXPLICIT pipeline transition: the agency owner marks a lead as a won
 * deal. Sets convertedAt, dealValue, status + pipelineStage = "converted".
 * Tenant-scoped. Idempotent (re-converting just updates dealValue).
 *
 * DELETE /api/leads/{leadId}/convert  — un-converts (mistake recovery): clears
 * convertedAt/dealValue and lets the stage fall back to its derived value.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  dealValue: z.number().nonnegative().max(10_000_000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { leadId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: z.infer<typeof BodySchema> = {};
  try {
    const raw = await req.json().catch(() => ({}));
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Tenant-scoped existence check — never let one tenant convert another's lead.
  const lead = await prisma.lead.findFirst({
    where:  { id: params.leadId, tenantId },
    select: { id: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const updated = await prisma.lead.update({
    where: { id: params.leadId },
    data: {
      status:        "converted",
      pipelineStage: "converted",
      convertedAt:   new Date(),
      ...(body.dealValue !== undefined ? { dealValue: body.dealValue } : {}),
    },
    select: { id: true, pipelineStage: true, convertedAt: true, dealValue: true },
  });

  return NextResponse.json({ ok: true, lead: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { leadId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const lead = await prisma.lead.findFirst({
    where:  { id: params.leadId, tenantId },
    select: { id: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Revert to "qualified" so the derived stage recomputes from real signals.
  await prisma.lead.update({
    where: { id: params.leadId },
    data:  { status: "qualified", convertedAt: null, dealValue: null },
  });

  return NextResponse.json({ ok: true });
}
