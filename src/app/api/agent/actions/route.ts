/**
 * GET /api/agent/actions?blueprintId={id}
 *
 * Returns the last 20 AgentAction rows for the given blueprint,
 * scoped to the authenticated tenant.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = orgId;

  const blueprintId = req.nextUrl.searchParams.get("blueprintId");
  if (!blueprintId) {
    return NextResponse.json(
      { error: "Missing required query parameter: blueprintId" },
      { status: 400 }
    );
  }

  const actions = await prisma.agentAction.findMany({
    where:   { tenantId, blueprintId },
    orderBy: { executedAt: "desc" },
    take:    20,
  });

  return NextResponse.json({ actions });
}
