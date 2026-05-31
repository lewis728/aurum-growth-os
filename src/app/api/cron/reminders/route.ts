/**
 * src/app/api/cron/reminders/route.ts
 * GET /api/cron/reminders
 * Protected by CRON_SECRET header. Called by Vercel Cron every 5 minutes.
 *
 * - Validates Authorization: Bearer <CRON_SECRET>
 * - Queries ScheduledReminder rows where status='pending' AND sendAt <= now
 * - Sends SMS via sendDirectSMS()
 * - Marks each reminder as 'sent' or 'failed' atomically
 * - Processes up to 50 reminders per invocation
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendDirectSMS } from "@/lib/services/twilioService";
import { placeSpeedToLeadCall } from "@/lib/services/speedToLeadService";
import { isOpenForReengagement, type ConversationState } from "@/lib/crm/conversationState";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;
const RETRY_BATCH = 20;
const NOSHOW_BATCH = 50;
const REENGAGE_BATCH = 30;

// ── Sprint 10C: phantom call-back loop ────────────────────────────────────────
// Recovers leads that went silent after first contact. Staged escalation keyed on
// reengageAttempts (we have no inbound-SMS channel, so "silent" = still open and
// no booking since lastContactAt):
//   attempt 0 → after 23m: pattern-interrupt SMS
//   attempt 1 → after 4h:  shift channel — Sophie calls again (Retell)
//   attempt 2 → after 24h: final nurture SMS
//   attempt 3 → after a further 24h: mark DORMANT (eligible for a future sequence)
// Every action stamps lastContactAt + increments reengageAttempts so the next
// stage can't fire early. Best-effort; never throws out of the cron.
async function processReEngagement(): Promise<number> {
  const now = Date.now();
  const min23 = new Date(now - 23 * 60 * 1000);
  const hr4   = new Date(now - 4 * 60 * 60 * 1000);
  const hr24  = new Date(now - 24 * 60 * 60 * 1000);

  // Open = not booked/converted and an FSM state still worth nurturing.
  const OPEN_STATES = ["INITIAL", "QUALIFYING", "OBJECTION_HANDLING", "NEGOTIATING", "BOOKING", "REENGAGED"];

  const leads = await prisma.lead.findMany({
    where: {
      conversationState: { in: OPEN_STATES },
      reengageAttempts:  { lt: 4 },
      lastContactAt:     { not: null, lte: min23 },
      status:            { notIn: ["booked", "converted", "no_answer"] },
    },
    orderBy: { lastContactAt: "asc" },
    take:    REENGAGE_BATCH,
    select:  {
      id: true, firstName: true, phone: true, blueprintId: true, tenantId: true,
      reengageAttempts: true, lastContactAt: true, conversationState: true,
    },
  });

  let actioned = 0;
  for (const lead of leads) {
    if (!lead.lastContactAt) continue;
    if (!isOpenForReengagement(lead.conversationState as ConversationState)) continue;
    const last = lead.lastContactAt.getTime();
    const name = lead.firstName || "there";

    try {
      if (lead.reengageAttempts === 0 && last <= min23.getTime()) {
        await sendDirectSMS(lead.phone, `Hey ${name}, my system cut out for a second — did you prefer morning or afternoon slots?`);
        await bumpReengage(lead.id, 1);
        actioned++;
      } else if (lead.reengageAttempts === 1 && last <= hr4.getTime()) {
        // Shift channel: call again via Retell (never throws).
        if (lead.blueprintId) {
          await placeSpeedToLeadCall({
            blueprintId: lead.blueprintId, tenantId: lead.tenantId,
            lead: { id: lead.id, firstName: lead.firstName, lastName: "", phone: lead.phone },
            isRetry: true,
          });
        }
        await bumpReengage(lead.id, 2);
        actioned++;
      } else if (lead.reengageAttempts === 2 && last <= hr24.getTime()) {
        await sendDirectSMS(lead.phone, `Still happy to help whenever you're ready, ${name}. The slot is yours if you want it.`);
        await bumpReengage(lead.id, 3);
        actioned++;
      } else if (lead.reengageAttempts >= 3 && last <= hr24.getTime()) {
        await prisma.lead.update({ where: { id: lead.id }, data: { conversationState: "DORMANT" } });
        actioned++;
      }
    } catch (e) {
      console.error("[reminders/reengage] lead failed:", lead.id, e instanceof Error ? e.message : e);
    }
  }
  return actioned;
}

async function bumpReengage(leadId: string, attempts: number): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data:  { reengageAttempts: attempts, lastContactAt: new Date() },
  }).catch(() => { /* non-fatal */ });
}

// ── Sprint 4: speed-to-lead retry ────────────────────────────────────────────
// Re-call leads who were called but whose call never produced analysis (no
// answer / voicemail), within a 2h–24h window, up to 3 attempts. Highest-intent
// leads (leadScore) are retried first. Returns the number of calls placed.
async function processCallRetries(): Promise<number> {
  const now            = Date.now();
  const twoHoursAgo    = new Date(now - 2  * 60 * 60 * 1000);
  const twentyFourHrs  = new Date(now - 24 * 60 * 60 * 1000);

  const candidates = await prisma.lead.findMany({
    where: {
      callAnalysis: { equals: Prisma.DbNull },
      retellCallId: { not: null },
      callAttempts: { lt: 3 },
      blueprintId:  { not: null },
      createdAt:    { gte: twentyFourHrs, lte: twoHoursAgo },
    },
    orderBy: [{ leadScore: "desc" }, { createdAt: "asc" }],
    take:    RETRY_BATCH,
    select:  { id: true, firstName: true, lastName: true, phone: true, blueprintId: true, tenantId: true },
  });

  let placed = 0;
  for (const lead of candidates) {
    if (!lead.blueprintId) continue;
    await placeSpeedToLeadCall({
      blueprintId: lead.blueprintId,
      tenantId:    lead.tenantId,
      lead:        { id: lead.id, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone },
      isRetry:     true,
    });
    placed++;
  }
  return placed;
}

// ── Sprint 5: no-show detection + follow-up ──────────────────────────────────
// Appointments still "confirmed" 30min–24h after their slot are treated as
// no-shows (the system has no attendance webhook). Marked idempotently to
// no_show and sent a rebook SMS. Returns the number processed.
async function processNoShows(): Promise<number> {
  const now      = Date.now();
  const cutoff   = new Date(now - 30 * 60 * 1000);
  const floor    = new Date(now - 24 * 60 * 60 * 1000);

  const noShows = await prisma.appointment.findMany({
    where:   { status: "confirmed", scheduledAt: { lt: cutoff, gte: floor } },
    take:    NOSHOW_BATCH,
    include: {
      lead:      { select: { firstName: true, phone: true } },
      blueprint: { select: { businessName: true, deployment: true } },
    },
  });

  let processed = 0;
  for (const appt of noShows) {
    try {
      await prisma.appointment.update({ where: { id: appt.id }, data: { status: "no_show" } });

      const businessName = appt.blueprint?.businessName ?? "us";
      const link = (appt.blueprint?.deployment as { websiteUrl?: string } | null)?.websiteUrl;
      const body = `Hi ${appt.lead.firstName}, we missed you for your appointment with ${businessName} today. ` +
        `Want to rebook?${link ? ` ${link}` : ""}`;
      await sendDirectSMS(appt.lead.phone, body);
      processed++;
    } catch (err) {
      console.error(`[cron/reminders] No-show follow-up failed for appointment ${appt.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return processed;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── 1. Validate cron secret ───────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cron/reminders] CRON_SECRET is not configured.");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Fetch due reminders ────────────────────────────────────────────────────
  const dueReminders = await prisma.scheduledReminder.findMany({
    where: {
      status: "pending",
      sendAt: { lte: new Date() },
    },
    take:    BATCH_SIZE,
    orderBy: { sendAt: "asc" },
    include: {
      appointment: {
        include: { lead: { select: { phone: true } } },
      },
    },
  });

  // ── Speed-to-lead retries + no-show follow-ups (independent of reminders) ──
  const [retried, noShows] = await Promise.all([
    processCallRetries().catch((e: unknown) => { console.error("[cron/reminders] retry pass failed:", e); return 0; }),
    processNoShows().catch((e: unknown)     => { console.error("[cron/reminders] no-show pass failed:", e); return 0; }),
  ]);

  if (dueReminders.length === 0) {
    return NextResponse.json({ processed: 0, retried, noShows }, { status: 200 });
  }

  let sent   = 0;
  let failed = 0;

  for (const reminder of dueReminders) {
    const phone = reminder.appointment.lead.phone;

    try {
      await sendDirectSMS(phone, reminder.messageBody);

      await prisma.scheduledReminder.update({
        where: { id: reminder.id },
        data:  { status: "sent", sentAt: new Date() },
      });

      sent++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/reminders] Failed to send reminder ${reminder.id}:`, errorMsg);

      await prisma.scheduledReminder.update({
        where: { id: reminder.id },
        data:  { status: "failed" },
      });

      failed++;
    }
  }

  return NextResponse.json({ processed: dueReminders.length, sent, failed, retried, noShows }, { status: 200 });
}
