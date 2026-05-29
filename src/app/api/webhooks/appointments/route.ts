/**
 * src/app/api/webhooks/appointments/route.ts
 * POST /api/webhooks/appointments
 * PUBLIC — No Clerk auth required. Called by calendar systems.
 *
 * - Validates HMAC signature via x-aurum-signature header
 * - Updates Appointment.confirmed = true
 * - Updates Lead.status = 'attended' or 'booked' based on event type
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/services/calendarService";

function validateSignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.APPOINTMENTS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[appointments webhook] APPOINTMENTS_WEBHOOK_SECRET is not configured.");
    return false;
  }
  const expected    = `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const signatureHeader = req.headers.get("x-aurum-signature") ?? "";
  if (!validateSignature(rawBody, signatureHeader)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const appointmentId = payload["appointmentId"] as string | undefined;
  const eventType     = payload["eventType"]     as string | undefined;

  if (!appointmentId) {
    return NextResponse.json({ error: "appointmentId is required" }, { status: 400 });
  }

  setImmediate(async () => {
    try {
      const appointment = await prisma.appointment.findUnique({
        where:  { id: appointmentId },
        select: { id: true, leadId: true },
      });

      if (!appointment) {
        console.warn("[appointments webhook] Appointment not found:", appointmentId);
        return;
      }

      const newLeadStatus = eventType === "attended" ? "attended" : "booked";

      await prisma.$transaction([
        prisma.appointment.update({
          where: { id: appointmentId },
          data:  { confirmed: true },
        }),
        prisma.lead.update({
          where: { id: appointment.leadId },
          data:  { status: newLeadStatus },
        }),
      ]);

      // Fire calendar sync after DB is updated — non-fatal, best-effort
      setImmediate(() => {
        void createCalendarEvent(appointmentId).catch((calErr) => {
          console.warn(
            "[appointments webhook] Calendar sync error (non-fatal):",
            calErr instanceof Error ? calErr.message : String(calErr)
          );
        });
      });
    } catch (err) {
      console.error("[appointments webhook] Processing error:", err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
