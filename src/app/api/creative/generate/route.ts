/**
 * POST /api/creative/generate
 * Generates a Higgsfield video ad for a blueprint and appends it (unapproved)
 * to blueprint.creative.assets.
 *
 * generateCreative() is synchronous — it submits the job and polls internally
 * (up to ~90s), returning a finished CreativeAsset. We therefore allow a long
 * route duration and return the asset directly; no client-side polling needed.
 *
 * Body: { blueprintId: string; brief?: string; style?: string }
 * Returns: { asset: CreativeAsset }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateCreative } from "@/lib/services/higgsFieldService";
import type { CreativeAsset } from "@/types/creativeLayer";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // allow for Higgsfield generate + poll

const STYLE_PROMPTS: Record<string, string> = {
  before_after: "before-and-after transformation showcase",
  lifestyle:    "aspirational lifestyle scene",
  testimonial:  "authentic customer testimonial",
  direct_offer: "direct-response offer with a clear call to action",
};

interface StoredCreative {
  assets?:         CreativeAsset[];
  brief?:          string;
  primaryAssetId?: string;
  [key: string]:   unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { blueprintId?: string; brief?: string; style?: string };
  try {
    body = (await req.json()) as { blueprintId?: string; brief?: string; style?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.blueprintId) {
    return NextResponse.json({ error: "blueprintId is required" }, { status: 400 });
  }

  const blueprint = await prisma.campaignBlueprint.findFirst({
    where:  { id: body.blueprintId, tenantId },
    select: { id: true, creative: true, offerHook: true, vertical: true, businessName: true },
  });
  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const styleKey   = body.style && STYLE_PROMPTS[body.style] ? body.style : "direct_offer";
  const brief      = body.brief?.trim() || `${blueprint.businessName} — ${blueprint.offerHook ?? blueprint.vertical}`;
  const prompt     = `${brief}. Style: ${STYLE_PROMPTS[styleKey]}. Vertical: ${blueprint.vertical}. 9:16 social video ad.`;

  let asset: CreativeAsset;
  try {
    asset = await generateCreative(prompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[creative/generate] failed:", msg);
    return NextResponse.json({ error: "Creative generation failed. Please try again." }, { status: 502 });
  }

  // Append to creative.assets (idempotent by assetId), persist brief.
  const creative = (blueprint.creative as StoredCreative | null) ?? {};
  const assets   = creative.assets ?? [];
  if (!assets.some(a => a.assetId === asset.assetId)) assets.push(asset);
  const updated: StoredCreative = { ...creative, assets, brief };

  await prisma.campaignBlueprint.update({
    where: { id: blueprint.id },
    data:  { creative: updated as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ asset });
}
