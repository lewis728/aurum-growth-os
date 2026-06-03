/**
 * src/lib/agents/marcusReasoning.ts
 * SERVER-SIDE ONLY. The "godlike" reasoning layer for Marcus (media buyer) — the
 * things a human buyer cannot do at decision time, on every account, 24/7:
 *
 *   1. computeTrend  — trajectory vs the prior window (never pause a RECOVERING
 *                      campaign; never scale a DEGRADING one) — humans eyeball this.
 *   2. detectAnomaly — flags a CPL/CTR/CPM/frequency move worth explaining.
 *   3. researchAnomaly — INSTANTLY researches the real world (live web + Meta Ad
 *                        Library) to find WHY (competitor promo, storm, seasonality)
 *                        before acting. This is the unfair advantage.
 *   4. verifyDecision — an adversarial senior-buyer pass that must FAIL to refute
 *                        the move before Marcus executes it (panel-of-experts > one
 *                        human's snap call).
 *
 * Every function is fail-safe: on error it degrades to "no extra signal / uphold"
 * so the media-buyer cycle always completes. NEVER THROWS.
 */

import { openai, MODELS } from "@/lib/services/openaiClient";
import { searchAdLibrary, summariseAds } from "@/lib/services/metaAdLibrary";
import { webSearch, compactWebResults, webSearchConfigured } from "@/lib/services/webSearch";
import type { MetaBreakdownRow } from "@/lib/services/metaAdsService";

// ── 1. Trajectory ─────────────────────────────────────────────────────────────
export interface Trend { summary: string; cplRising: boolean; cplFallingFast: boolean }

function pct(now: number, was: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(was) || was <= 0) return null;
  return ((now - was) / was) * 100;
}
function arrow(p: number | null): string {
  if (p == null) return "→ (no prior)";
  const s = p >= 0 ? "+" : "";
  return `${p > 3 ? "↑" : p < -3 ? "↓" : "→"} ${s}${p.toFixed(0)}%`;
}

/** Compares the current window to the prior window. Pure. */
export function computeTrend(cur: MetaBreakdownRow, prior: MetaBreakdownRow | null): Trend {
  if (!prior) return { summary: "TREND: no prior-window data to compare.", cplRising: false, cplFallingFast: false };
  const cpl = pct(cur.cpl, prior.cpl);
  const ctr = pct(cur.ctr, prior.ctr);
  const cpm = pct(cur.cpm, prior.cpm);
  const freq = pct(cur.frequency, prior.frequency);
  const summary =
    `TREND (this window vs prior): CPL ${arrow(cpl)} (£${prior.cpl.toFixed(2)}→£${cur.cpl.toFixed(2)}), ` +
    `CTR ${arrow(ctr)}, CPM ${arrow(cpm)}, frequency ${arrow(freq)}, ` +
    `leads ${prior.leads}→${cur.leads}.`;
  return { summary, cplRising: cpl != null && cpl > 15, cplFallingFast: cpl != null && cpl < -15 };
}

// ── 2. Anomaly detection ──────────────────────────────────────────────────────
export interface Anomaly { anomalous: boolean; reasons: string[] }

export function detectAnomaly(cur: MetaBreakdownRow, prior: MetaBreakdownRow | null, benchmarkGbp: number | null): Anomaly {
  const reasons: string[] = [];
  if (prior) {
    const cpl = pct(cur.cpl, prior.cpl);
    const ctr = pct(cur.ctr, prior.ctr);
    const cpm = pct(cur.cpm, prior.cpm);
    if (cpl != null && cpl > 40) reasons.push(`CPL spiked ${cpl.toFixed(0)}% vs the prior window`);
    if (ctr != null && ctr < -30) reasons.push(`CTR collapsed ${Math.abs(ctr).toFixed(0)}% vs the prior window`);
    if (cpm != null && cpm > 40) reasons.push(`CPM jumped ${cpm.toFixed(0)}% vs the prior window`);
  }
  if (benchmarkGbp != null && cur.cpl > benchmarkGbp * 2) reasons.push(`CPL £${cur.cpl.toFixed(2)} is >2× the £${benchmarkGbp.toFixed(2)} benchmark`);
  if (cur.frequency >= 3.0) reasons.push(`frequency ${cur.frequency.toFixed(1)} ≥ 3.0 (saturation)`);
  return { anomalous: reasons.length > 0, reasons };
}

// ── 3. Live research — find out WHY, instantly ────────────────────────────────
/**
 * Researches the real world to explain an anomaly: live web (storms/competitor
 * promos/news) + Meta Ad Library (who's newly advertising locally). Returns a
 * concise finding for the evidence pack, or "" if nothing/unavailable. NEVER THROWS.
 */
export async function researchAnomaly(opts: {
  businessName: string; city: string; vertical: string; reasons: string[];
}): Promise<string> {
  const parts: string[] = [];
  try {
    if (webSearchConfigured()) {
      const q = `${opts.city} ${opts.vertical} demand OR storm OR weather OR competitor promotion ${new Date().getFullYear()}`;
      const web = await webSearch(q, 5);
      const compact = compactWebResults(web, 5);
      if (compact) parts.push(`LIVE WEB (why this might be happening):\n${compact}`);
    }
  } catch { /* graceful */ }
  try {
    const ads = await searchAdLibrary(`${opts.city} ${opts.vertical}`, { country: "GB", limit: 10 });
    if (ads.length) parts.push(`LOCAL COMPETITORS NOW ADVERTISING (${ads.length} live):\n${summariseAds(ads, 8)}`);
  } catch { /* graceful */ }
  if (parts.length === 0) return "";
  return `LIVE RESEARCH (triggered by: ${opts.reasons.join("; ")}):\n${parts.join("\n\n")}`;
}

// ── 4. Adversarial verification — must fail to refute before we execute ────────
export interface Verdict { uphold: boolean; reason: string }

/**
 * A skeptical 30-year senior buyer reviews the proposed EXECUTABLE action and tries
 * to refute it. Returns uphold=false only when there's a strong reason NOT to act
 * (so Marcus downgrades to a recommendation). Defaults to uphold=true on any error —
 * the adversarial check can veto, never block. NEVER THROWS.
 */
export async function verifyDecision(opts: {
  action: string; chain: string; evidence: string; trendSummary: string;
}): Promise<Verdict> {
  if (!process.env.OPENAI_API_KEY) return { uphold: true, reason: "no model — proceeding" };
  try {
    const completion = await openai.chat.completions.create({
      model: MODELS.primary,
      temperature: 0.1,
      max_tokens: 250,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a skeptical media buyer with 30 years' experience, doing a final review of a proposed action " +
            "before money moves. Try HARD to refute it. Veto (uphold=false) only if there's a strong, specific reason " +
            "NOT to act now — e.g.: the campaign is still in the learning phase; the trend shows it's already " +
            "RECOVERING (don't pause a campaign whose CPL is falling fast); a cheaper lever should be tried first per " +
            "the client's playbook (creative refresh before pausing); the data is too thin; or the move risks a " +
            "learning reset for little gain. If the action is sound, uphold it. Respond ONLY as JSON " +
            '{"uphold": boolean, "reason": string (one sentence)}.',
        },
        {
          role: "user",
          content:
            `PROPOSED ACTION: ${opts.action}\n\nREASONING CHAIN:\n${opts.chain}\n\n${opts.trendSummary}\n\n` +
            `EVIDENCE (incl. the client's optimisation playbook + target bands):\n${opts.evidence.slice(0, 6000)}\n\n` +
            `Should Marcus execute this now? Refute if you can.`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { uphold?: unknown; reason?: unknown };
    return {
      uphold: parsed.uphold !== false, // default to act unless explicitly vetoed
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (err) {
    console.error("[marcusReasoning] verifyDecision failed:", err instanceof Error ? err.message : err);
    return { uphold: true, reason: "verifier unavailable — proceeding on the primary diagnosis" };
  }
}
