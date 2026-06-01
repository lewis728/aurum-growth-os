/**
 * GET /api/cron/outreach-autopilot
 * The "run it like a pro" heartbeat. Every run (hourly) it:
 *   1. generates sequences for any new pending prospects (qualify → hook → 5 emails),
 *      choosing the A/B subject variant the tuner currently favours,
 *   2. auto-pushes freshly-generated, emailable prospects into Instantly,
 *   3. logs the run + (once a day) texts the owner a short performance digest.
 *
 * This is what makes it hands-off: Clay feeds prospects in via /clay-ingest, and
 * this cron carries them all the way to "emailing" without anyone opening the app.
 * Auth: Bearer CRON_SECRET. Fail-safe throughout.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processProspect } from "@/lib/outreach/persist";
import { chooseVariant, abReport } from "@/lib/outreach/abTuner";
import { dispatchProspects } from "@/lib/outreach/dispatch";
import { reengageDueProspects } from "@/lib/outreach/reengagement";
import { notifyOwner } from "@/lib/outreach/notify";
import { logOutreachEvent } from "@/lib/outreach/events";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const GEN_LIMIT = 30;       // prospects qualified+written per run
const PUSH_LIMIT = 50;      // prospects injected to Instantly per run
const CONCURRENCY = 4;
// A clinic that finished all 5 emails this many days ago with no reply goes dormant
// (then re-engages 90 days later). 14 covers the day-0..14 cadence + a buffer.
const SEQUENCE_DAYS = 18;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Run per tenant that has outreach activity (usually just Lewis's agency).
  const tenants = await prisma.outreachProspect
    .findMany({ distinct: ["tenantId"], select: { tenantId: true } })
    .catch(() => [] as { tenantId: string }[]);

  const summary = { tenants: tenants.length, generated: 0, rejected: 0, errored: 0, pushed: 0, dormant: 0, reengaged: 0 };

  for (const { tenantId } of tenants) {
    // ── 1. Generate sequences for pending prospects ───────────────────────────
    const pending = await prisma.outreachProspect.findMany({
      where: { tenantId, status: "pending" }, orderBy: { createdAt: "asc" }, take: GEN_LIMIT, select: { id: true },
    }).catch(() => [] as { id: string }[]);

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const idx = cursor++;
        try {
          const variant = await chooseVariant(tenantId, idx);
          const r = await processProspect({ prospectId: pending[idx].id, tenantId, variantIndex: variant });
          // record which variant this prospect actually got, for the A/B stats
          await prisma.outreachProspect.update({ where: { id: pending[idx].id }, data: { subjectVariant: variant } }).catch(() => {});
          if (r.status === "generated") summary.generated++;
          else if (r.status === "rejected") summary.rejected++;
          else summary.errored++;
        } catch (err) {
          // Per-item isolation: one prospect's failure must not kill the worker
          // (which would abort all CONCURRENCY workers via Promise.all).
          summary.errored++;
          console.error(`[cron/outreach-autopilot] prospect ${pending[idx]?.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    // ── 2. Auto-push generated → Instantly (suppression-checked, message-logged) ─
    const disp = await dispatchProspects({ tenantId, limit: PUSH_LIMIT });
    summary.pushed += disp.pushed;

    // ── 2b. Mark finished-but-silent sequences dormant (→ 90-day re-engagement) ─
    const seqDoneBefore = new Date(Date.now() - SEQUENCE_DAYS * 24 * 60 * 60 * 1000);
    const dormant = await prisma.outreachProspect.updateMany({
      where: { tenantId, status: "emailing", repliedAt: null, lastEmailAt: { lte: seqDoneBefore } },
      data:  { status: "dormant", dormantAt: new Date(), reengageAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
    }).catch(() => ({ count: 0 }));
    summary.dormant += dormant.count;

    // ── 2c. Re-engage dormant prospects whose 90 days are up (fresh angle) ──────
    const re = await reengageDueProspects(tenantId, 25);
    summary.reengaged += re.requeued;

    await logOutreachEvent(tenantId, "autopilot_run", `gen ${summary.generated} push ${summary.pushed} dormant ${summary.dormant} reengaged ${summary.reengaged} rej ${summary.rejected} err ${summary.errored}`);

    // ── 3. Daily digest (once/day, at the 6am-ish run) ────────────────────────
    const hour = new Date().getUTCHours();
    if (hour === 6) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [booked, replied, emailing, ab] = await Promise.all([
        prisma.outreachProspect.count({ where: { tenantId, bookedAt: { gte: since } } }),
        prisma.outreachProspect.count({ where: { tenantId, repliedAt: { gte: since } } }),
        prisma.outreachProspect.count({ where: { tenantId, status: "emailing" } }),
        abReport(tenantId),
      ]);
      const best = ab.variants[ab.bestVariant];
      await notifyOwner(
        `☀️ Outreach, last 24h:\n` +
        `• ${booked} demo(s) booked\n• ${replied} replies\n• ${emailing} clinics in active sequences\n` +
        `• Best subject = variant ${ab.bestVariant + 1} (${Math.round((best?.replyRate ?? 0) * 100)}% reply rate)`,
      );
    }
  }

  return NextResponse.json({ ok: true, ...summary }, { status: 200 });
}
