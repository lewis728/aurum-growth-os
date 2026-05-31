/**
 * POST /api/admin/set-blueprint-live
 * One-time admin/ops endpoint to flip a blueprint to status="live" so the
 * speed-to-lead call flow can be tested without full Meta campaign setup.
 * (speedToLeadService silently no-ops unless status === "live".)
 *
 * Auth: Authorization: Bearer <CRON_SECRET> — same scheme as the cron routes.
 * Body: { blueprintId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { blueprintId?: string };
  try {
    body = (await req.json()) as { blueprintId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.blueprintId) {
    return NextResponse.json({ error: "blueprintId is required" }, { status: 400 });
  }

  const existing = await prisma.campaignBlueprint.findUnique({
    where:  { id: body.blueprintId },
    select: { id: true, status: true, businessName: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  await prisma.campaignBlueprint.update({
    where: { id: body.blueprintId },
    data:  { status: "live" },
  });

  return NextResponse.json({
    success:       true,
    blueprintId:   existing.id,
    businessName:  existing.businessName,
    previousStatus: existing.status,
    status:        "live",
  });
}
