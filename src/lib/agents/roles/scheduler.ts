/**
 * src/lib/agents/roles/scheduler.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── THE SCHEDULER (e.g. "James") ────────────────────────────────────────────
 * One of the FIVE independent specialist roles (caller · scheduler · mediaBuyer ·
 * reporter · learner). See roles/caller.ts for the shared role contract.
 *
 * THE SCHEDULER'S JOB: handle everything that happens AFTER a call — create the
 * appointment, flip the lead's status, book the calendar, queue reminders, send
 * the confirmation/nudge SMS, and extract objections from the transcript.
 *
 * Handoff is DB-only: the Caller hands work to the Scheduler purely through the
 * Retell post-call webhook (no direct call between roles). Downstream roles
 * (Reporter, Learner) read the rows the Scheduler writes — again, no direct call.
 *
 * FAIL-SAFE: handleCallOutcome NEVER THROWS. Each side effect (calendar, reminders,
 * SMS) is isolated so one failing step never blocks the others. It returns an
 * HTTP-shaped result the webhook echoes back. After lead resolution it always
 * returns 200 so Retell never retries into a double-book (Appointment.leadId is
 * unique, so a retry would no-op anyway).
 *
 * This is the proven post-call logic relocated from the calls webhook verbatim,
 * then hardened — behaviour on the verified booking path is unchanged.
 */

import { prisma } from "@/lib/prisma";
import { queueAppointmentReminders, sendDirectSMS } from "@/lib/services/twilioService";
import { extractObjections } from "@/lib/services/objectionService";
import { createCalendarEvent } from "@/lib/services/calendarService";
import type { LeadStatus } from "@/types/lead";

// ── Retell post-call payload (only what we consume) ─────────────────────────
export interface RetellCallAnalysis {
  call_id?:    string;
  transcript?: string;
  custom_analysis_data?: {
    isQualified?:         boolean;
    appointmentBooked?:   boolean;
    appointmentSlotTime?: string;
    ptName?:              string;
    leadPhone?:           string;
    leadId?:              string;
  };
  call?: { call_id?: string; transcript?: string };
}

export interface CallOutcomeResult {
  status: number;
  body:   Record<string, unknown>;
}

function deriveLeadStatus(analysis: {
  isQualified?:       boolean;
  appointmentBooked?: boolean;
  inVoicemail?:       boolean;
}): LeadStatus {
  if (analysis.appointmentBooked) return "booked";
  if (analysis.isQualified)       return "qualified";
  if (analysis.inVoicemail)       return "no_answer";
  return "called";
}

/**
 * The Scheduler's single entry point. Takes the parsed Retell post-call payload
 * (signature already verified by the webhook) and the blueprintId. NEVER THROWS.
 */
export async function handleCallOutcome(
  blueprintId: string,
  payload: RetellCallAnalysis,
): Promise<CallOutcomeResult> {
  const analysis = payload.custom_analysis_data ?? {};
  const leadStatus = deriveLeadStatus(analysis);

  // Resolve identifiers — call_id is the reliable correlation (persisted on the
  // Lead when the speed-to-lead call was placed), with fallbacks.
  const callId =
    (typeof payload.call_id === "string" ? payload.call_id : null) ??
    payload.call?.call_id ??
    null;
  const leadId    = analysis.leadId;
  const leadPhone = analysis.leadPhone;

  if (!callId && !leadId && !leadPhone) {
    return { status: 200, body: { success: true, note: "no identifier" } };
  }

  try {
    const select = { id: true, tenantId: true, firstName: true } as const;
    let lead =
      callId
        ? await prisma.lead.findFirst({ where: { retellCallId: callId, blueprintId }, select })
        : null;
    if (!lead && leadId)    lead = await prisma.lead.findFirst({ where: { id: leadId }, select });
    if (!lead && leadPhone) lead = await prisma.lead.findFirst({ where: { phone: leadPhone, blueprintId }, select });

    if (!lead) {
      console.warn("[scheduler] Lead not found:", { callId, leadId, leadPhone, blueprintId });
      return { status: 200, body: { success: true, note: "lead not found" } };
    }

    const blueprint = await prisma.campaignBlueprint.findUnique({
      where:  { id: blueprintId },
      select: { businessName: true, deployment: true },
    });
    const businessName = blueprint?.businessName ?? "us";
    const landingUrl   = (blueprint?.deployment as { websiteUrl?: string } | null)?.websiteUrl ?? null;

    // Best-effort SMS — never blocks lead/appointment persistence.
    const safeSms = async (body: string): Promise<void> => {
      if (!leadPhone) return;
      try { await sendDirectSMS(leadPhone, body); }
      catch (e) { console.error("[scheduler] SMS failed:", e instanceof Error ? e.message : e); }
    };

    // Extract objections from the transcript and fold into callAnalysis.
    const transcript =
      (typeof payload.transcript === "string" ? payload.transcript : null) ??
      payload.call?.transcript ??
      "";
    const objections = transcript ? await extractObjections(transcript) : [];
    const callAnalysisData = { ...payload, objections } as object;

    // ── Booking path: valid future slot ──────────────────────────────────────
    if (
      analysis.appointmentBooked &&
      analysis.appointmentSlotTime &&
      new Date(analysis.appointmentSlotTime) > new Date()
    ) {
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
          // FSM (Sprint 10C): a booked lead is CONFIRMED.
          data:  { status: "booked", callAnalysis: callAnalysisData, conversationState: "CONFIRMED", lastContactAt: new Date() },
        }),
      ]);

      // Each side effect isolated — one failing never blocks the others.
      await createCalendarEvent(appointment.id).catch((e: unknown) =>
        console.error("[scheduler] calendar event failed:", e instanceof Error ? e.message : e),
      );
      await queueAppointmentReminders(appointment.id, lead.id).catch((e: unknown) =>
        console.error("[scheduler] reminder queue failed:", e instanceof Error ? e.message : e),
      );

      const when = new Date(analysis.appointmentSlotTime).toLocaleString("en-GB", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });
      await safeSms(
        `Hi ${lead.firstName}, great speaking with you! Your appointment with ${businessName} is confirmed for ${when}. See you then.`,
      );

      return { status: 200, body: { success: true, booked: true } };
    }

    // ── Non-booking path: update status, nudge qualified leads ────────────────
    await prisma.lead.update({
      where: { id: lead.id },
      data:  { status: leadStatus, callAnalysis: callAnalysisData },
    });

    if (leadStatus === "qualified") {
      await safeSms(
        `Hi ${lead.firstName}, ${businessName} would love to help.` +
        (landingUrl ? ` Book your free consultation: ${landingUrl}` : " Reply here to book your free consultation."),
      );
    }

    return { status: 200, body: { success: true } };
  } catch (err) {
    // Absolute backstop — the role must never throw into the webhook.
    console.error("[scheduler] handleCallOutcome error:", err instanceof Error ? err.message : err);
    return { status: 200, body: { success: true, note: "handled with errors" } };
  }
}
