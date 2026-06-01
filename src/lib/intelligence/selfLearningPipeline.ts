/**
 * src/lib/intelligence/selfLearningPipeline.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── MARCUS LEARNS FROM HIS OWN TRACK RECORD ─────────────────────────────────
 * Case-Based Reasoning is only as good as the case library. This pipeline closes
 * the loop: every decision Marcus actually EXECUTES is traced, then scored 48h
 * later against the campaign's real Meta CPL, and promoted back into
 * `DecisionExample` as a positive or negative precedent. Next time Marcus faces a
 * similar situation, his OWN past outcome is one of the 5 cases he reasons from.
 *
 * WHY A LEDGER, NOT FIRE-AND-FORGET SCORING: a decision made now cannot be judged
 * now — the 48h CPL window hasn't happened yet. So `trackDecisionOutcomeInBackground`
 * (1) writes the decision to the `DecisionTrace` ledger with its baseline CPL, and
 * (2) opportunistically evaluates any of this client's traces that are now ≥48h old,
 * pulling the real post-decision CPL from Meta (queryable by historical date range)
 * and writing the finalised case. A cron can also call {@link evaluateDueDecisions}
 * across all clients. The few-shot library (`DecisionExample`) only ever holds
 * finalised cases; in-flight decisions live in the ledger.
 *
 * Fire-and-forget. NEVER THROWS, NEVER BLOCKS the media-buyer cycle.
 */

import { prisma } from "@/lib/prisma";
import { getCampaignInsightsSummary } from "@/lib/services/metaAdsService";
import { generateRealEmbedding, insertDecisionExample } from "@/lib/intelligence/decisionLibrary";

const EVAL_DELAY_HOURS  = 48;            // a decision is scorable 48h after it was made
const EVAL_WINDOW_DAYS  = 2;             // CPL window we score over (the 48h after the decision)
const SCALE_HOLD_TOLERANCE = 1.15;       // SCALE is a "win" if post-CPL ≤ baseline × 1.15
const MAX_EVAL_PER_RUN  = 25;            // bound work per opportunistic pass

export interface DecisionContext {
  blueprintId:    string;
  tenantId:       string;
  vertical:       string;
  metaCampaignId: string | null;
  actionType:     string;   // "SCALE_BUDGET" | "PAUSE_CAMPAIGN" (executed actions only)
  situation:      string;
  diagnosis:      string;
  action:         string;
  baselineCpl:    number;    // CPL of the observation window at decision time
}

const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Called fire-and-forget right after Marcus EXECUTES an action. Records the
 * decision to the ledger, then scores any of this client's now-due traces.
 * NEVER THROWS, NEVER BLOCKS.
 */
export async function trackDecisionOutcomeInBackground(ctx: DecisionContext): Promise<void> {
  try {
    await prisma.decisionTrace
      .create({
        data: {
          blueprintId:    ctx.blueprintId,
          tenantId:       ctx.tenantId,
          vertical:       ctx.vertical,
          metaCampaignId: ctx.metaCampaignId,
          actionType:     ctx.actionType,
          situation:      ctx.situation,
          diagnosis:      ctx.diagnosis,
          action:         ctx.action,
          baselineCpl:    Number.isFinite(ctx.baselineCpl) ? ctx.baselineCpl : null,
        },
      })
      .catch((e: unknown) => console.error("[selfLearning] trace create failed:", e instanceof Error ? e.message : e));

    // Opportunistic: score this client's due traces while we're here.
    await evaluateDueDecisions(ctx.blueprintId, ctx.tenantId);
  } catch (err) {
    console.error("[selfLearning] trackDecisionOutcomeInBackground failed:", err instanceof Error ? err.message : err);
  }
}

/** Pulls the CPL for an explicit historical window. Returns null if unavailable. NEVER THROWS. */
async function cplForWindow(campaignId: string, since: Date, until: Date, tenantId: string): Promise<number | null> {
  try {
    const row = await getCampaignInsightsSummary(campaignId, { since: fmtDate(since), until: fmtDate(until) }, tenantId);
    return typeof row?.cpl === "number" && Number.isFinite(row.cpl) ? row.cpl : null;
  } catch (err) {
    console.error("[selfLearning] cplForWindow failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Scores every DecisionTrace for this blueprint that is now ≥48h old and not yet
 * evaluated, promoting finalised cases into DecisionExample. Scoped to one client
 * when blueprintId is given; pass nothing to sweep all clients (cron use).
 * NEVER THROWS.
 */
export async function evaluateDueDecisions(blueprintId?: string, tenantId?: string): Promise<number> {
  let evaluated = 0;
  try {
    const cutoff = new Date(Date.now() - EVAL_DELAY_HOURS * 60 * 60 * 1000);
    const due = await prisma.decisionTrace.findMany({
      where: {
        evaluatedAt: null,
        decidedAt:   { lte: cutoff },
        ...(blueprintId ? { blueprintId } : {}),
        ...(tenantId ? { tenantId } : {}),
      },
      orderBy: { decidedAt: "asc" },
      take: MAX_EVAL_PER_RUN,
    });

    for (const t of due) {
      try {
        await evaluateOneTrace(t);
        evaluated++;
      } catch (e) {
        console.error("[selfLearning] evaluateOneTrace failed:", e instanceof Error ? e.message : e);
        // Best-effort: mark evaluated so a permanently un-scorable trace doesn't loop forever.
        await prisma.decisionTrace.update({ where: { id: t.id }, data: { evaluatedAt: new Date() } }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[selfLearning] evaluateDueDecisions failed:", err instanceof Error ? err.message : err);
  }
  return evaluated;
}

interface TraceRow {
  id: string; blueprintId: string; tenantId: string; vertical: string;
  metaCampaignId: string | null; actionType: string;
  situation: string; diagnosis: string; action: string;
  baselineCpl: number | null; decidedAt: Date;
}

async function evaluateOneTrace(t: TraceRow): Promise<void> {
  const markDone = () => prisma.decisionTrace.update({ where: { id: t.id }, data: { evaluatedAt: new Date() } });

  // No campaign to read → nothing scorable; close the trace.
  if (!t.metaCampaignId) { await markDone(); return; }

  let outcome: string | null = null;
  let lesson: string | null = null;
  let quality = 0.75;

  if (t.actionType === "PAUSE_CAMPAIGN") {
    // A paused campaign has ~no spend in the window, so post-CPL isn't meaningful.
    // The pause itself is the protective outcome — record it as a precedent.
    const base = t.baselineCpl != null ? `£${t.baselineCpl.toFixed(2)}` : "an elevated level";
    outcome = `Campaign was paused while CPL sat at ${base}. Pausing stopped further spend on under-performing delivery; the decision protected budget rather than feeding a losing auction.`;
    lesson  = "When CPL is well above benchmark with real spend and few conversions, pausing is the correct, decisive move — it stops the bleed rather than hoping a tired campaign self-corrects.";
    quality = 0.7;
  } else if (t.actionType === "SCALE_BUDGET") {
    if (t.baselineCpl == null || t.baselineCpl <= 0) { await markDone(); return; }
    const since = t.decidedAt;
    const until = new Date(t.decidedAt.getTime() + EVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const postCpl = await cplForWindow(t.metaCampaignId, since, until, t.tenantId);
    if (postCpl == null) { await markDone(); return; } // can't score honestly → close, no example

    const pct = ((postCpl - t.baselineCpl) / t.baselineCpl) * 100;
    const pctStr = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    const held = postCpl <= t.baselineCpl * SCALE_HOLD_TOLERANCE;
    if (held) {
      outcome = `After scaling, CPL moved from £${t.baselineCpl.toFixed(2)} to £${postCpl.toFixed(2)} over 48h (${pctStr}) — the scale held.`;
      lesson  = "Scaling this profile held CPL: a sub-benchmark CPL with healthy frequency could absorb the +20% step without the auction punishing it. Confirms +20% steps on genuine winners are safe.";
      quality = 0.85;
    } else {
      outcome = `After scaling, CPL rose from £${t.baselineCpl.toFixed(2)} to £${postCpl.toFixed(2)} within 48h (${pctStr}) — scaling outran the audience.`;
      lesson  = "Scaling here spiked CPL: the audience couldn't absorb more budget without frequency/CPM rising. Next time, take a smaller step (or refresh creative / widen audience first) before scaling this profile.";
      quality = 0.7; // a clear negative lesson is still a valuable precedent
    }
  } else {
    // Non-executable action type slipped through → nothing to score.
    await markDone();
    return;
  }

  const embedding = await generateRealEmbedding(t.situation);
  await insertDecisionExample({
    id:        `dex_sl_${t.id}`, // deterministic → ON CONFLICT DO NOTHING dedupes re-runs
    vertical:  t.vertical,
    situation: t.situation,
    diagnosis: t.diagnosis,
    action:    t.action,
    outcome,
    lesson,
    source:    "self_learned",
    quality,
    embedding,
  });

  await markDone();
}
