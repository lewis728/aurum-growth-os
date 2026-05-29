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
import { prisma } from "@/lib/prisma";
import { sendDirectSMS } from "@/lib/services/twilioService";

const BATCH_SIZE = 50;

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

  if (dueReminders.length === 0) {
    return NextResponse.json({ processed: 0 }, { status: 200 });
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

  return NextResponse.json({ processed: dueReminders.length, sent, failed }, { status: 200 });
}
