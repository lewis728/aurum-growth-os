/**
 * POST /api/admin/refresh-research  (Part 10)
 * Re-runs the hyper-local onboarding research sweep for an existing blueprint.
 * CRON_SECRET-gated (admin/ops use). Takes { blueprintId } (+ optional tenantId;
 * resolved from the blueprint if omitted). Awaited here so the caller sees the
 * outcome — runOnboardingResearch never throws.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runOnboardingResearch } from "@/lib/intelligence/onboardingResearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { blueprintId?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const blueprintId = typeof body.blueprintId === "string" ? body.blueprintId : "";
  if (!blueprintId) return NextResponse.json({ error: "blueprintId required" }, { status: 400 });

  const bp = await prisma.campaignBlueprint.findUnique({ where: { id: blueprintId }, select: { tenantId: true } });
  if (!bp) return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });

  await runOnboardingResearch(blueprintId, bp.tenantId);
  return NextResponse.json({ ok: true, blueprintId });
}
