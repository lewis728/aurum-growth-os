/**
 * POST   /api/clients/{blueprintId}/messages/{messageId}/approve
 *   The agency owner approves a held reply → mark approved + sent, and record the
 *   outbound message. body: { edited?: string } to tweak the reply before sending.
 * DELETE /api/clients/{blueprintId}/messages/{messageId}/approve
 *   Dismiss a held reply without sending (clears requiresApproval).
 *
 * Tenant-scoped. The actual channel send (WhatsApp/SMS) is wired in Sprint 10;
 * for now "sent" means recorded + surfaced in the dashboard thread.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { safeWhatsApp } from "@/lib/services/twilioService";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ edited: z.string().max(4000).optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: { blueprintId: string; messageId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: z.infer<typeof BodySchema> = {};
  try { body = BodySchema.parse(await req.json().catch(() => ({}))); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  // Tenant-scoped lookup of the held inbound message.
  const msg = await prisma.clientMessage.findFirst({
    where:  { id: params.messageId, tenantId, blueprintId: params.blueprintId },
  });
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const replyText = (body.edited ?? msg.agentResponse ?? "").trim();
  if (!replyText) return NextResponse.json({ error: "No reply text to send" }, { status: 400 });

  const now = new Date();

  // Deliver via WhatsApp when that's the channel and a number is on file.
  // Best-effort: a delivery failure still records the approval (owner sees it in
  // the thread and can retry), it just isn't marked as channel-delivered.
  let delivered = false;
  if (msg.channel === "whatsapp") {
    const brief = await prisma.clientBrief
      .findUnique({ where: { blueprintId: params.blueprintId }, select: { clientWhatsApp: true } })
      .catch(() => null);
    const wa = brief?.clientWhatsApp?.trim();
    if (wa) {
      const sid = await safeWhatsApp(wa, replyText);
      delivered = sid !== null;
    }
  }

  // Mark the inbound row approved + record the outbound reply, atomically.
  await prisma.$transaction([
    prisma.clientMessage.update({
      where: { id: msg.id },
      data:  { requiresApproval: false, approvedAt: now, agentResponse: replyText, sentAt: now },
    }),
    prisma.clientMessage.create({
      data: {
        blueprintId: params.blueprintId, tenantId, direction: "outbound",
        channel: msg.channel, intent: msg.intent, content: replyText, sentAt: now,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, sent: true, delivered });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { blueprintId: string; messageId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const msg = await prisma.clientMessage.findFirst({
    where:  { id: params.messageId, tenantId, blueprintId: params.blueprintId },
    select: { id: true },
  });
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  await prisma.clientMessage.update({
    where: { id: msg.id },
    data:  { requiresApproval: false },
  });
  return NextResponse.json({ ok: true, dismissed: true });
}
