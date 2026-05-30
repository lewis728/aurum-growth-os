/**
 * GET /api/agent/briefing?blueprintId={id}
 *
 * Returns the latest stored morning briefing for a blueprint, tenant-scoped.
 * Shape: { briefingText: string | null, briefingAt: string | null, agentName: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const blueprintId = req.nextUrl.searchParams.get("blueprintId");
  if (!blueprintId) {
    return NextResponse.json(
      { error: "Missing required query parameter: blueprintId" },
      { status: 400 }
    );
  }

  const [blueprint, rep] = await Promise.all([
    prisma.campaignBlueprint.findFirst({
      where:  { id: blueprintId, tenantId },
      select: { lastBriefingText: true, lastBriefingAt: true },
    }),
    prisma.aIRepresentative.findUnique({
      where:  { blueprintId },
      select: { repName: true },
    }),
  ]);

  if (!blueprint) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    briefingText: blueprint.lastBriefingText ?? null,
    briefingAt:   blueprint.lastBriefingAt?.toISOString() ?? null,
    agentName:    rep?.repName ?? "Your Agent",
  });
}
