/**
 * src/lib/outreach/abTuner.ts
 * SERVER-SIDE ONLY. The "always A/B testing, amending" brain. Email-1 ships in 3
 * subject variants (see emailSequences.ts). This computes, per tenant, which
 * variant is winning on reply rate and returns the index the next batch should
 * lean toward — so the system self-tunes over time. NEVER THROWS.
 *
 * Strategy: epsilon-greedy. Most of the time, send the best-performing variant;
 * occasionally explore the others so a slow starter still gets a fair sample.
 * (Deterministic exploration via a passed-in counter — no Math.random, which is
 * unavailable in some runtimes and breaks reproducibility.)
 */

import { prisma } from "@/lib/prisma";
import { EMAIL_SEQUENCE } from "@/lib/outreach/emailSequences";

const VARIANT_COUNT = EMAIL_SEQUENCE[0]?.subjects.length ?? 3;
const MIN_SAMPLE = 8; // below this many sends per variant, keep exploring evenly

export interface VariantStat {
  variant: number;
  sent:    number;  // prospects given this variant that were emailed
  replied: number;
  replyRate: number;
}

export interface AbReport {
  variants:   VariantStat[];
  bestVariant: number;
  totalSent:  number;
  totalReplied: number;
}

/** Computes per-variant reply stats for a tenant. */
export async function abReport(tenantId: string): Promise<AbReport> {
  const variants: VariantStat[] = Array.from({ length: VARIANT_COUNT }, (_, v) => ({
    variant: v, sent: 0, replied: 0, replyRate: 0,
  }));

  try {
    const rows = await prisma.outreachProspect.findMany({
      where: { tenantId, subjectVariant: { not: null }, emailsSent: { gt: 0 } },
      select: { subjectVariant: true, repliedAt: true },
    });
    for (const r of rows) {
      const v = r.subjectVariant;
      if (v == null || v < 0 || v >= VARIANT_COUNT) continue;
      variants[v].sent++;
      if (r.repliedAt) variants[v].replied++;
    }
    for (const s of variants) s.replyRate = s.sent > 0 ? s.replied / s.sent : 0;
  } catch (err) {
    console.error("[abTuner] report failed:", err instanceof Error ? err.message : err);
  }

  const totalSent = variants.reduce((a, s) => a + s.sent, 0);
  const totalReplied = variants.reduce((a, s) => a + s.replied, 0);
  const bestVariant = variants.reduce((best, s) => (s.replyRate > variants[best].replyRate ? s.variant : best), 0);
  return { variants, bestVariant, totalSent, totalReplied };
}

/**
 * Chooses the subject variant for the next prospect at batch-position `idx`.
 * Epsilon-greedy with deterministic exploration: every 3rd prospect explores
 * (round-robins all variants for coverage); the rest exploit the current best.
 * Until each variant has MIN_SAMPLE sends, we explore evenly so the test is fair.
 */
export async function chooseVariant(tenantId: string, idx: number): Promise<number> {
  const report = await abReport(tenantId);
  const underSampled = report.variants.some((s) => s.sent < MIN_SAMPLE);
  if (underSampled) return idx % VARIANT_COUNT;        // fair coverage first
  if (idx % 3 === 0) return idx % VARIANT_COUNT;       // explore ~1/3 of the time
  return report.bestVariant;                            // exploit the winner
}
