/**
 * src/app/api/campaigns/route.ts
 * GET /api/campaigns
 *
 * Returns all CampaignBlueprint rows for the authenticated tenant.
 * Used by useCampaigns() SWR hook.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma }        from "@/lib/prisma";
import { canLaunchCampaign } from "@/lib/access/subscriptionGuard";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

// ─── POST /api/campaigns ─────────────────────────────────────────────────────
// Placeholder for future direct blueprint creation endpoint.
// Currently blueprints are created via /api/onboarding/chat.
// Guard is here so any future POST is protected from the start.
export async function POST(req: NextRequest): Promise<NextResponse> { // eslint-disable-line @typescript-eslint/no-unused-vars
const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId;

  const access = await canLaunchCampaign(tenantId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }

  // Blueprint creation logic goes here when needed
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}

// ─── GET /api/campaigns ───────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId;

  try {
    const blueprints = await prisma.campaignBlueprint.findMany({
      where:   { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(blueprints);
  } catch (err) {
    console.error("[GET /api/campaigns] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
