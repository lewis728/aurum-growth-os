/**
 * src/app/api/leads/route.ts
 * GET /api/leads?blueprintId={blueprintId}
 *
 * Returns all Lead rows for the authenticated tenant scoped to a blueprint.
 * Used by useLeads() SWR hook.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTenantId }               from "@/lib/auth";
import { prisma }                    from "@/lib/prisma";

export async function GET(request: NextRequest): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    });

    return NextResponse.json(leads);
  } catch (err) {
    console.error("[GET /api/leads] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
