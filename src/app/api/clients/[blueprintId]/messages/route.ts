/**
 * src/app/api/clients/[blueprintId]/messages/route.ts
 * GET  — list the message thread for a client (newest first).
 * POST — record an inbound client message and run the Communicator role
 *        (classify intent → draft reply → auto-send or hold for approval).
 *
 * Tenant-scoped via the canonical auth pattern.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { handleClientMessage } from "@/lib/agents/roles/communicator";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const messages = await prisma.clientMessage.findMany({
    where:   { tenantId, blueprintId: params.blueprintId },
    orderBy: { createdAt: "desc" },
    take:    100,
  });
  return NextResponse.json({ messages });
}

const PostSchema = z.object({
  content: z.string().min(1).max(4000),
  channel: z.string().max(20).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // Tenant-scoped ownership check.
  const blueprint = await prisma.campaignBlueprint.findFirst({
    where:  { id: params.blueprintId, tenantId },
    select: { id: true },
  });
  if (!blueprint) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const result = await handleClientMessage({
    blueprintId: params.blueprintId,
    tenantId,
    content: body.content,
    channel: body.channel,
  });

  return NextResponse.json(result);
}
