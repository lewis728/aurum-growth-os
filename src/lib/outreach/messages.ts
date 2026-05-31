/**
 * src/lib/outreach/messages.ts
 * SERVER-SIDE ONLY. Writes to the OutreachMessage system-of-record — every email
 * sent and every reply received, kept forever and searchable. NEVER THROWS
 * (logging must never break the pipeline).
 */

import { prisma } from "@/lib/prisma";

export async function logOutbound(opts: {
  tenantId: string;
  prospectId: string;
  emailNumber?: number;
  subject: string;
  body: string;
  status?: "sent" | "failed";
  externalId?: string | null;
}): Promise<void> {
  try {
    await prisma.outreachMessage.create({
      data: {
        tenantId: opts.tenantId, prospectId: opts.prospectId, direction: "outbound",
        channel: "email", emailNumber: opts.emailNumber ?? null,
        subject: opts.subject.slice(0, 500), body: opts.body.slice(0, 8000),
        status: opts.status ?? "sent", externalId: opts.externalId ?? null,
      },
    });
  } catch (err) {
    console.error("[messages] logOutbound failed:", err instanceof Error ? err.message : err);
  }
}

export async function logInbound(opts: {
  tenantId: string;
  prospectId: string;
  body: string;
  subject?: string;
}): Promise<void> {
  try {
    await prisma.outreachMessage.create({
      data: {
        tenantId: opts.tenantId, prospectId: opts.prospectId, direction: "inbound",
        channel: "email", subject: opts.subject?.slice(0, 500) ?? null,
        body: opts.body.slice(0, 8000), status: "received",
      },
    });
  } catch (err) {
    console.error("[messages] logInbound failed:", err instanceof Error ? err.message : err);
  }
}

/** Bulk-logs the full generated sequence as outbound 'sent' records (used at push). */
export async function logSequenceSent(opts: {
  tenantId: string;
  prospectId: string;
  emails: { emailNumber: number; subject: string; body: string }[];
  externalId?: string | null;
}): Promise<void> {
  try {
    await prisma.outreachMessage.createMany({
      data: opts.emails.map((e) => ({
        tenantId: opts.tenantId, prospectId: opts.prospectId, direction: "outbound",
        channel: "email", emailNumber: e.emailNumber,
        subject: e.subject.slice(0, 500), body: e.body.slice(0, 8000),
        status: "sent", externalId: opts.externalId ?? null,
      })),
    });
  } catch (err) {
    console.error("[messages] logSequenceSent failed:", err instanceof Error ? err.message : err);
  }
}
