/**
 * src/lib/outreach/reengagement.ts
 * SERVER-SIDE ONLY. The 90-day re-engagement engine. A clinic that went through
 * all 5 emails with no reply isn't dead — it's "not now". This:
 *   1. markDormant()   — when a sequence finishes unanswered, parks the prospect
 *      'dormant' and stamps reengageAt = now + 90 days.
 *   2. reengageDueProspects() — finds dormant prospects past their reengageAt,
 *      writes a FRESH single email with a NEW angle (never the same 5), re-queues
 *      them, and bumps reengageCount. Capped at MAX_REENGAGE cycles so we never
 *      become a pest, and always suppression-checked.
 *
 * NEVER THROWS at the top level.
 */

import { prisma } from "@/lib/prisma";
import { isSuppressed } from "@/lib/outreach/suppression";

import { openai } from "@/lib/services/openaiClient";

export const REENGAGE_AFTER_DAYS = 90;
export const MAX_REENGAGE = 2; // at most 2 re-engagement cycles, ever

/** Marks a prospect dormant and schedules its 90-day re-engagement. */
export async function markDormant(prospectId: string): Promise<void> {
  const reengageAt = new Date(Date.now() + REENGAGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  await prisma.outreachProspect.update({
    where: { id: prospectId },
    data:  { status: "dormant", dormantAt: new Date(), reengageAt },
  }).catch(() => {});
}

interface ReengageEmail { subject: string; body: string; }

/** Writes a fresh, different re-engagement email — new angle, not the old 5. */
async function writeReengageEmail(opts: {
  firstName: string; businessName: string; location: string; cycle: number;
}): Promise<ReengageEmail | null> {
  if (!process.env.OPENAI_API_KEY) {
    // Deterministic fallback so re-engagement still works without the model.
    return {
      subject: "still got space for you",
      body: `Hey ${opts.firstName || "there"},\n\nCircled back round to ${opts.businessName}. We've been quietly filling calendars for a few clinics near ${opts.location || "you"} since I last emailed — booked consultations, no upfront cost, you only pay if it works.\n\nWorth a quick look now the timing might suit better?\n\nLewis`,
    };
  }
  const system =
    `You are Lewis, founder of a marketing agency, re-emailing an aesthetics clinic owner who ` +
    `never replied to your sequence ~3 months ago. Sound human, casual, lowercase-friendly, SHORT ` +
    `(3-5 sentences). NO jargon, never say "AI". This is a FRESH angle, not a repeat — acknowledge ` +
    `time has passed, lead with a NEW reason to talk (a recent win / new capacity / a seasonal hook), ` +
    `and re-anchor on the 28-day risk-free guarantee: real booked consultations, pay nothing unless ` +
    `it works. Output STRICT JSON only.`;
  const user = [
    `Prospect: ${opts.firstName || "there"} at ${opts.businessName}${opts.location ? ` in ${opts.location}` : ""}.`,
    `This is re-engagement cycle ${opts.cycle} (after ${REENGAGE_AFTER_DAYS} days of silence).`,
    `Write a fresh re-opener. Return JSON: {"subject": string (lowercase, <6 words), "body": string}.`,
    `Body opens "Hey ${opts.firstName || "there"}," and signs off "Lewis". No links.`,
  ].join("\n");
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", temperature: 0.7, max_tokens: 320,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<ReengageEmail>;
    if (typeof parsed.subject === "string" && typeof parsed.body === "string" && parsed.body.trim()) {
      return { subject: parsed.subject.trim(), body: parsed.body.trim() };
    }
    return null;
  } catch (err) {
    console.error("[reengagement] write failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface ReengageResult { processed: number; requeued: number; retired: number; }

/**
 * Finds dormant prospects whose 90 days are up and re-engages them with a fresh
 * email (stored as a new OutreachSequence row, emailNumber 6+). Caps at
 * MAX_REENGAGE cycles; suppression-checked. NEVER THROWS.
 */
export async function reengageDueProspects(tenantId: string, limit = 25): Promise<ReengageResult> {
  const res: ReengageResult = { processed: 0, requeued: 0, retired: 0 };
  let due: { id: string; firstName: string | null; companyName: string; cleanCompanyName: string | null; location: string | null; contactEmail: string | null; reengageCount: number }[] = [];
  try {
    due = await prisma.outreachProspect.findMany({
      where: { tenantId, status: "dormant", reengageAt: { lte: new Date() }, unsubscribed: false },
      orderBy: { reengageAt: "asc" }, take: limit,
      select: { id: true, firstName: true, companyName: true, cleanCompanyName: true, location: true, contactEmail: true, reengageCount: true },
    });
  } catch { return res; }

  for (const p of due) {
    res.processed++;
    // Retire prospects that have exhausted their re-engagement cycles.
    if (p.reengageCount >= MAX_REENGAGE) {
      await prisma.outreachProspect.update({ where: { id: p.id }, data: { status: "closed", reengageAt: null } }).catch(() => {});
      res.retired++;
      continue;
    }
    // Respect suppression.
    if (await isSuppressed(tenantId, p.contactEmail)) {
      await prisma.outreachProspect.update({ where: { id: p.id }, data: { status: "closed", reengageAt: null } }).catch(() => {});
      res.retired++;
      continue;
    }

    const cycle = p.reengageCount + 1;
    const email = await writeReengageEmail({
      firstName: p.firstName ?? "there",
      businessName: p.cleanCompanyName || p.companyName,
      location: p.location ?? "",
      cycle,
    });
    if (!email) continue;

    // Store as the next sequence step and re-queue for sending (status 'generated'
    // so the autopilot's push step picks it up like any other ready prospect).
    const nextNum = 5 + cycle; // 6, then 7
    await prisma.$transaction([
      prisma.outreachSequence.create({
        data: { prospectId: p.id, emailNumber: nextNum, subject: email.subject, body: email.body, scheduledAt: new Date() },
      }),
      prisma.outreachProspect.update({
        where: { id: p.id },
        data: { status: "generated", reengageCount: cycle, reengageAt: null, dormantAt: null },
      }),
    ]).catch(() => {});
    res.requeued++;
  }
  return res;
}
