/**
 * POST /api/clients/upgrade-tier
 * Upgrades a single client from Starter to Full service.
 * Body: { blueprintId: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { blueprintId?: string };
  try {
    body = (await req.json()) as { blueprintId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.blueprintId) {
    return NextResponse.json({ error: "blueprintId is required" }, { status: 400 });
  }

  // Tenant-scoped update — updateMany ensures a client from another tenant
  // can never be mutated even if its id is guessed.
  const result = await prisma.campaignBlueprint.updateMany({
    where: { id: body.blueprintId, tenantId },
    data:  { clientTier: "full_service" },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, clientTier: "full_service" });
}
