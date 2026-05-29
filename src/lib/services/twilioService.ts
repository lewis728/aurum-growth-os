// src/lib/services/twilioService.ts
// Twilio SMS automation service for Aurum Growth OS.
// Handles speed-to-lead immediate SMS sends and appointment reminder queuing.
// SERVER-SIDE ONLY. Never import inside a "use client" component.

import twilio from "twilio";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/utils/withRetry";
import { ReminderMessageType } from "@/enums/campaignEnums";

// ─── Environment Guards ───────────────────────────────────────────────────────

function getTwilioClient(): ReturnType<typeof twilio> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid) throw new Error("TWILIO_ACCOUNT_SID is not configured");
  if (!token) throw new Error("TWILIO_AUTH_TOKEN is not configured");
  return twilio(sid, token);
}

function getFromNumber(): string {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error("TWILIO_FROM_NUMBER is not configured");
  return from;
}

// ─── Phone Normalisation ──────────────────────────────────────────────────────

/**
 * Normalises a UK or international phone number to E.164 format.
 * UK numbers starting with 07 become +447...
 */
function normaliseToE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("44") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("07") && digits.length === 11) return `+44${digits.slice(1)}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;

  throw new Error(
    `Cannot normalise phone number to E.164: "${phone}". ` +
      `Expected UK (07xxx) or international format.`
  );
}

// ─── sendDirectSMS ────────────────────────────────────────────────────────────

/**
 * Sends an SMS immediately via Twilio to the given phone number.
 * Normalises the number to E.164 format before sending.
 * Returns the Twilio message SID on success.
 * Wrapped in withRetry() per GR-02.
 */
export async function sendDirectSMS(to: string, body: string): Promise<string> {
  const client = getTwilioClient();
  const from = getFromNumber();
  const toE164 = normaliseToE164(to);

  const message = await withRetry(
    () =>
      client.messages.create({
        to: toE164,
        from,
        body,
      }),
    { maxAttempts: 3, baseDelayMs: 500, label: "TwilioService.sendDirectSMS" }
  );

  return message.sid;
}

// ─── queueAppointmentReminders ────────────────────────────────────────────────

export interface ReminderTemplates {
  confirmation: string;
  day_before: string;
  hour_before: string;
}

/**
 * Pre-queues up to three ScheduledReminder rows for a given appointment:
 * CONFIRMATION (immediate), DAY_BEFORE (24h before slot), HOUR_BEFORE (1h before slot).
 *
 * GR-07: Uses skipDuplicates — safe to call multiple times for the same appointment.
 * GR-08: messageBody is fully rendered at queue time. Cron worker sends without joins.
 *
 * Template variables: {{LEAD_NAME}}, {{BUSINESS_NAME}}
 */
export async function queueAppointmentReminders(
  appointmentId: string,
  leadId: string,
  templates?: ReminderTemplates
): Promise<void> {
  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: {
      lead: {
        select: { phone: true, firstName: true, lastName: true, tenantId: true },
      },
    },
  });

  const { scheduledAt, tenantId } = appointment;
  const { phone, firstName, lastName } = appointment.lead;
  const toNumber = normaliseToE164(phone);
  const leadName = `${firstName} ${lastName}`.trim();
  const now = new Date();

  const defaultTemplates: ReminderTemplates = {
    confirmation:
      "Hi {{LEAD_NAME}}, your consultation has been confirmed. We look forward to speaking with you. — {{BUSINESS_NAME}}",
    day_before:
      "Hi {{LEAD_NAME}}, a reminder that your consultation is tomorrow. Reply STOP to cancel. — {{BUSINESS_NAME}}",
    hour_before:
      "Hi {{LEAD_NAME}}, your consultation is in 1 hour. We'll call you shortly. — {{BUSINESS_NAME}}",
  };

  const tpl = templates ?? defaultTemplates;

  const render = (template: string): string =>
    template
      .replace(/\{\{LEAD_NAME\}\}/g, leadName)
      .replace(/\{\{BUSINESS_NAME\}\}/g, "Aurum Growth");

  const confirmationAt = now;
  const dayBeforeAt = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
  const hourBeforeAt = new Date(scheduledAt.getTime() - 60 * 60 * 1000);

  const reminders: {
    appointmentId: string;
    tenantId: string;
    messageType: string;
    messageBody: string;
    toNumber: string;
    sendAt: Date;
  }[] = [
    {
      appointmentId,
      tenantId,
      messageType: ReminderMessageType.CONFIRMATION,
      messageBody: render(tpl.confirmation),
      toNumber,
      sendAt: confirmationAt,
    },
  ];

  if (dayBeforeAt > now) {
    reminders.push({
      appointmentId,
      tenantId,
      messageType: ReminderMessageType.DAY_BEFORE,
      messageBody: render(tpl.day_before),
      toNumber,
      sendAt: dayBeforeAt,
    });
  }

  if (hourBeforeAt > now) {
    reminders.push({
      appointmentId,
      tenantId,
      messageType: ReminderMessageType.HOUR_BEFORE,
      messageBody: render(tpl.hour_before),
      toNumber,
      sendAt: hourBeforeAt,
    });
  }

  // GR-07: skipDuplicates backed by @@unique([appointmentId, messageType])
  await prisma.scheduledReminder.createMany({
    data: reminders,
    skipDuplicates: true,
  });

  // Suppress unused parameter warning — leadId is passed for future audit logging
  void leadId;
}
