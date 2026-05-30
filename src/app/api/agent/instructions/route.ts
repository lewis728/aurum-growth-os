/**
 * /api/agent/instructions
 *
 * GET  ?blueprintId=  — list active instructions for a blueprint
 * POST { blueprintId, instruction } — create a new instruction
 * DELETE ?id= — soft-delete (isActive = false)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

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

  const instructions = await prisma.agentInstruction.findMany({
    where: { tenantId, blueprintId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ instructions });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  const body = (await req.json()) as { blueprintId?: string; instruction?: string };
  const { blueprintId, instruction } = body;

  if (!blueprintId || !instruction) {
    return NextResponse.json({ error: "Missing required fields: blueprintId, instruction" }, { status: 400 });
  }

  const created = await prisma.agentInstruction.create({
    data: { tenantId, blueprintId, instruction },
  });

  return NextResponse.json({ instruction: created });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing required query parameter: id" }, { status: 400 });
  }

  // Verify the row belongs to this tenant before updating
  const existing = await prisma.agentInstruction.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.agentInstruction.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
