/**
 * POST /api/contractor-portal/[id]/pause  — token-authed (magic-link token)
 * Body: { token, paused: boolean }. Toggles the contractor's territory between
 * active and paused. Pausing stops new bookings/charges; never resurrects an
 * unpaid (pending) contractor.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyContractorToken } from "@/lib/contractorToken";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: { token?: string; paused?: boolean };
  try {
    body = (await req.json()) as { token?: string; paused?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cid = body.token ? verifyContractorToken(body.token) : null;
  if (!cid || cid !== params.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id: params.id },
    select: { status: true },
  });
  if (!contractor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (contractor.status !== "active" && contractor.status !== "paused") {
    return NextResponse.json({ error: "Contractor is not active yet" }, { status: 409 });
  }

  const status = body.paused ? "paused" : "active";
  await prisma.contractor.update({ where: { id: params.id }, data: { status } });
  return NextResponse.json({ status });
}
