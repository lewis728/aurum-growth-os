/**
 * src/app/api/webhooks/calls/[blueprintId]/route.ts
 * POST /api/webhooks/calls/:blueprintId
 * PUBLIC — No Clerk auth required. Called by Retell voice AI.
 *
 * - Validates HMAC signature via x-retell-signature header (sha256=)
 * - Extracts custom_analysis_data from post-call payload
 * - Creates Appointment + updates Lead status atomically if booked
 * - Queues appointment reminders non-blocking
 * - Returns 200 within 3 seconds
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { queueAppointmentReminders } from "@/lib/services/twilioService";
import type { LeadStatus } from "@/types/lead";

export const dynamic = "force-dynamic";

// ── HMAC validation ───────────────────────────────────────────────────────────
function validateRetellSignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[calls webhook] RETELL_WEBHOOK_SECRET is not configured.");
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

// ── Lead status derivation ────────────────────────────────────────────────────
function deriveLeadStatus(analysis: {
  isQualified?:     boolean;
  appointmentBooked?: boolean;
  inVoicemail?:     boolean;
}): LeadStatus {
  if (analysis.appointmentBooked) return "booked";
  if (analysis.isQualified)       return "qualified";
  if (analysis.inVoicemail)       return "no_answer";
  return "called";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<NextResponse> {
  const { blueprintId } = params;

  // ── 1. Read raw body BEFORE parsing ──────────────────────────────────────────
  const rawBody = await req.text();

  // ── 2. Validate HMAC signature ────────────────────────────────────────────────
  const signatureHeader = req.headers.get("x-retell-signature") ?? "";
  if (!validateRetellSignature(rawBody, signatureHeader)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Parse payload ──────────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const analysis = (payload["custom_analysis_data"] ?? {}) as {
    isQualified?:        boolean;
    appointmentBooked?:  boolean;
    appointmentSlotTime?: string;
    ptName?:             string;
    leadPhone?:          string;
    leadId?:             string;
  };

  const leadStatus = deriveLeadStatus(analysis);

  // ── 4. Resolve lead ───────────────────────────────────────────────────────────
  const leadId    = analysis.leadId;
  const leadPhone = analysis.leadPhone;

  if (!leadId && !leadPhone) {
    // No way to identify lead — log and return 200 (don't retry)
    console.warn("[calls webhook] No leadId or leadPhone in analysis data.");
    return NextResponse.json({ success: true }, { status: 200 });
  }

  // ── 5. Heavy processing via setImmediate ──────────────────────────────────────
  setImmediate(async () => {
    try {
      // Find lead
      const lead = await prisma.lead.findFirst({
        where: leadId
          ? { id: leadId }
          : { phone: leadPhone!, blueprintId },
        select: { id: true, tenantId: true },
      });

      if (!lead) {
        console.warn("[calls webhook] Lead not found:", { leadId, leadPhone, blueprintId });
        return;
      }

      // If appointment was booked and slotTime is valid future date
      if (
        analysis.appointmentBooked &&
        analysis.appointmentSlotTime &&
        new Date(analysis.appointmentSlotTime) > new Date()
      ) {
        // Atomic transaction: create Appointment + update Lead status
        const [appointment] = await prisma.$transaction([
          prisma.appointment.create({
            data: {
              blueprintId,
              leadId:      lead.id,
              tenantId:    lead.tenantId,
              scheduledAt: new Date(analysis.appointmentSlotTime),
              confirmed:   false,
              notes:       analysis.ptName ? `Patient: ${analysis.ptName}` : undefined,
            },
          }),
          prisma.lead.update({
            where: { id: lead.id },
            data:  { status: "booked" },
          }),
        ]);

        // Queue SMS reminders non-blocking
        await queueAppointmentReminders(appointment.id, lead.id);
      } else {
        // Just update lead status
        await prisma.lead.update({
          where: { id: lead.id },
          data:  { status: leadStatus, callAnalysis: payload as object },
        });
      }
    } catch (err) {
      console.error("[calls webhook] Processing error:", err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
