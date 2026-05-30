/**
 * POST /api/creative/approve
 * Marks a generated asset as the primary creative for the blueprint's next
 * campaign (CreativeLayer has no boolean approved flag — primaryAssetId is the
 * approved one).
 * Body: { blueprintId: string; assetId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CreativeAsset } from "@/types/creativeLayer";

export const dynamic = "force-dynamic";

interface StoredCreative {
  assets?:         CreativeAsset[];
  primaryAssetId?: string;
  [key: string]:   unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { blueprintId?: string; assetId?: string };
  try {
    body = (await req.json()) as { blueprintId?: string; assetId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.blueprintId || !body.assetId) {
    return NextResponse.json({ error: "blueprintId and assetId are required" }, { status: 400 });
  }

  const blueprint = await prisma.campaignBlueprint.findFirst({
    where:  { id: body.blueprintId, tenantId },
    select: { id: true, creative: true },
  });
  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const creative = (blueprint.creative as StoredCreative | null) ?? {};
  const exists   = (creative.assets ?? []).some(a => a.assetId === body.assetId);
  if (!exists) {
    return NextResponse.json({ error: "Asset not found on this blueprint" }, { status: 404 });
  }

  const updated: StoredCreative = { ...creative, primaryAssetId: body.assetId };
  await prisma.campaignBlueprint.update({
    where: { id: blueprint.id },
    data:  { creative: updated as unknown as Prisma.InputJsonValue },
  });

  return NextResponse.json({ success: true, primaryAssetId: body.assetId });
}
