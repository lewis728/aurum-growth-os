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
import { injectLeads, instantlyConfigured, type InstantlyLead } from "@/lib/outreach/instantlyClient";
import { notifyOwner } from "@/lib/outreach/notify";
import { logOutreachEvent } from "@/lib/outreach/events";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const GEN_LIMIT = 30;       // prospects qualified+written per run
const PUSH_LIMIT = 50;      // prospects injected to Instantly per run
const CONCURRENCY = 4;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Run per tenant that has outreach activity (usually just Lewis's agency).
  const tenants = await prisma.outreachProspect
    .findMany({ distinct: ["tenantId"], select: { tenantId: true } })
    .catch(() => [] as { tenantId: string }[]);

  const summary = { tenants: tenants.length, generated: 0, rejected: 0, errored: 0, pushed: 0 };

  for (const { tenantId } of tenants) {
    // ── 1. Generate sequences for pending prospects ───────────────────────────
    const pending = await prisma.outreachProspect.findMany({
      where: { tenantId, status: "pending" }, orderBy: { createdAt: "asc" }, take: GEN_LIMIT, select: { id: true },
    }).catch(() => [] as { id: string }[]);

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const idx = cursor++;
        const variant = await chooseVariant(tenantId, idx);
        const r = await processProspect({ prospectId: pending[idx].id, tenantId, variantIndex: variant });
        // record which variant this prospect actually got, for the A/B stats
        await prisma.outreachProspect.update({ where: { id: pending[idx].id }, data: { subjectVariant: variant } }).catch(() => {});
        if (r.status === "generated") summary.generated++;
        else if (r.status === "rejected") summary.rejected++;
        else summary.errored++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    // ── 2. Auto-push generated → Instantly ────────────────────────────────────
    if (instantlyConfigured()) {
      const ready = await prisma.outreachProspect.findMany({
        where: { tenantId, status: "generated", contactEmail: { not: null }, customHook: { not: null }, unsubscribed: false },
        take: PUSH_LIMIT,
        select: { id: true, firstName: true, companyName: true, cleanCompanyName: true, contactEmail: true, customHook: true },
      }).catch(() => []);

      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const eligible = ready.filter((p) => p.contactEmail && EMAIL_RE.test(p.contactEmail) && p.customHook);
      if (eligible.length > 0) {
        const leads: InstantlyLead[] = eligible.map((p) => ({
          email: p.contactEmail as string,
          first_name: p.firstName ?? "there",
          custom_hook: p.customHook ?? "",
          custom_clean_name: p.cleanCompanyName ?? p.companyName,
        }));
        const res = await injectLeads(leads);
        await Promise.all(eligible.map((p, i) => {
          const id = res.leadIds[i];
          if (!id) return Promise.resolve();
          summary.pushed++;
          return prisma.outreachProspect.update({
            where: { id: p.id },
            data: { status: "emailing", instantlyLeadId: id, emailsSent: 1, lastEmailAt: new Date() },
          }).catch(() => {});
        }));
      }
    }

    await logOutreachEvent(tenantId, "autopilot_run", `gen ${summary.generated} push ${summary.pushed} rej ${summary.rejected} err ${summary.errored}`);

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
