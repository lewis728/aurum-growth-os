// src/app/api/admin/insights/route.ts
// GET /api/admin/insights
// Internal monitoring endpoint — NEVER user-facing.
//
// Authentication: x-admin-secret header must match ADMIN_SECRET env var.
// No Clerk auth required — this is a backend admin endpoint.
//
// Returns: VerticalInsightsSummary[] for all verticals with sampleSize > 0.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVerticalInsightsSummary } from "@/lib/services/insightsService";
import { ServiceVertical } from "@/enums/campaignEnums";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const providedSecret = req.headers.get("x-admin-secret") ?? "";
  if (providedSecret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Fetch all VerticalProfiles with sampleSize > 0 ─────────────────────────
  const profiles = await prisma.verticalProfile.findMany({
    select: { vertical: true, performanceData: true },
  });

  // Filter to only those with sampleSize > 0
  const activeProfiles = profiles.filter((p) => {
    const data = p.performanceData as { sampleSize?: number } | null;
    return typeof data?.sampleSize === "number" && data.sampleSize > 0;
  });

  // Build VerticalInsightsSummary for each
  const summaries = await Promise.all(
    activeProfiles.map((p) =>
      getVerticalInsightsSummary(p.vertical as ServiceVertical)
    )
  );

  return NextResponse.json(summaries, { status: 200 });
}
