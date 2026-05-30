/**
 * GET /api/leads/objections?blueprintId={id}
 * Returns the top objections for a blueprint over the last 7 days.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { aggregateObjections } from "@/lib/services/objectionService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  const blueprintId = req.nextUrl.searchParams.get("blueprintId");
  if (!blueprintId) {
    return NextResponse.json({ error: "Missing required query parameter: blueprintId" }, { status: 400 });
  }

  const objections = await aggregateObjections(blueprintId, tenantId, { days: 7, limit: 3 });
  return NextResponse.json({ objections });
}
