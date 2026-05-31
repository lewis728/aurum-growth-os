/**
 * src/app/api/leads/route.ts
 * GET /api/leads?blueprintId={blueprintId}
 *
 * Returns all Lead rows for the authenticated tenant scoped to a blueprint, each
 * with its DERIVED CRM pipeline stage (Sprint 3B) computed from the lead's status
 * + appointment outcome. The derived stage is lazily persisted back to
 * Lead.pipelineStage (only when it changed) so God Mode's indexed pipeline-value
 * aggregate stays accurate without a dedicated write at every lifecycle event.
 *
 * Used by the client sub-account pipeline board + useLeads() SWR hook.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma }                    from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { derivePipelineStage } from "@/lib/crm/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const blueprintId = request.nextUrl.searchParams.get("blueprintId");
  if (!blueprintId) {
    return NextResponse.json(
      { error: "Missing required query parameter: blueprintId" },
      { status: 400 }
    );
  }

  try {
    const leads = await prisma.lead.findMany({
      where:   { tenantId, blueprintId },
      orderBy: { createdAt: "desc" },
      include: {
        appointment: { select: { status: true, scheduledAt: true, notes: true } },
      },
    });

    const now = Date.now();

    // Derive each lead's pipeline stage; collect rows whose stored stage drifted.
    const drift: { id: string; stage: string }[] = [];
    const result = leads.map((l) => {
      const stage = derivePipelineStage({
        leadStatus:        l.status,
        callAttempts:      l.callAttempts,
        convertedAt:       l.convertedAt,
        appointmentStatus: l.appointment?.status ?? null,
        appointmentPast:   l.appointment ? l.appointment.scheduledAt.getTime() < now : false,
      });
      if (stage !== l.pipelineStage) drift.push({ id: l.id, stage });
      return { ...l, pipelineStage: stage };
    });

    // Lazily reconcile drifted rows — best-effort, never blocks the response.
    if (drift.length > 0) {
      void Promise.allSettled(
        drift.map((d) =>
          prisma.lead.update({ where: { id: d.id }, data: { pipelineStage: d.stage } })
        )
      ).catch(() => { /* non-fatal */ });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/leads] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
