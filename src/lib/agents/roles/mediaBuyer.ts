/**
 * src/lib/agents/roles/mediaBuyer.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── THE MEDIA BUYER ("Marcus") ──────────────────────────────────────────────
 * The 3rd specialist role (caller · scheduler · mediaBuyer · reporter · learner).
 * See roles/caller.ts for the shared role contract.
 *
 * MARCUS'S JOB: every 4 hours, manage ONE client's Meta campaign like a media
 * buyer with 30 years of experience — OBSERVE all the data, DIAGNOSE *why*
 * performance is what it is, DECIDE within hard safety guardrails, ACT once, and
 * LOG the full reasoning chain in plain English.
 *
 * THE 5-STEP BRAIN (replaces the old 5-rule CPL threshold tree):
 *   1. OBSERVE  — campaign + ad-set + ad (creative) + audience breakdowns from Meta
 *   2. DIAGNOSE — GPT-4o causal reasoning over ALL the data + the client brief +
 *                 Kai's nightly learnings + the vertical benchmark
 *   3. DECIDE   — safety guardrails applied AFTER GPT-4o (never the model's job):
 *                   · never exceed ClientBrief.budgetHardLimit
 *                   · change > approvalThreshold → NEEDS_APPROVAL (don't execute)
 *                   · confidence < 0.7 → recommendation only (don't execute)
 *                   · one action per cycle, maximum
 *   4. ACT      — execute the single diagnosed action via the Meta API
 *   5. LOG      — AgentAction with the full diagnosis chain + alert escalation
 *
 * DB-only handoff; never calls another role. NEVER THROWS. If GPT diagnosis is
 * unavailable, falls back to the proven deterministic engine (agentReasoningService)
 * so a campaign is never left unmanaged.
 */

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { ServiceVertical } from "@/enums/campaignEnums";
import { buildClientContext } from "@/lib/agents/clientContext";
import { runAgentReasoningCycle, type ClientBriefGuardrails } from "@/lib/services/agentReasoningService";
import { maybeAlertForAction } from "@/lib/services/alertService";
import {
  getCampaignInsightsSummary,
  getAdSetInsights,
  getAdInsights,
  getAudienceInsights,
  pauseCampaign,
  updateCampaignBudget,
  type MetaBreakdownRow,
} from "@/lib/services/metaAdsService";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MEDIA_BUYER_NAME = "Marcus";
const USD_TO_GBP = 1 / 1.27;
const CONFIDENCE_FLOOR = 0.7;
const OBSERVE_DAYS = 14;

// The only action types Marcus may decide. Anything else is coerced to NO_ACTION.
type MarcusActionType =
  | "PAUSE_CAMPAIGN"
  | "SCALE_BUDGET"
  | "RECOMMEND_CREATIVE_REFRESH"
  | "FLAG_LOW_CTR"
  | "NO_ACTION";
const VALID_ACTIONS = new Set<MarcusActionType>([
  "PAUSE_CAMPAIGN", "SCALE_BUDGET", "RECOMMEND_CREATIVE_REFRESH", "FLAG_LOW_CTR", "NO_ACTION",
]);
// Actions Marcus can actually EXECUTE; the rest are advisory-only by nature.
const EXECUTABLE = new Set<MarcusActionType>(["PAUSE_CAMPAIGN", "SCALE_BUDGET"]);

interface Diagnosis {
  diagnosis:       string;
  action:          string;        // plain-English description of the chosen action
  actionType:      MarcusActionType;
  expectedOutcome: string;
  watchFor:        string;
  confidence:      number;        // 0-1
}

export interface MediaBuyerResult {
  blueprintId: string;
  status: "acted" | "recommended" | "needs_approval" | "no_action" | "no_campaign" | "meta_unavailable" | "fallback" | "skipped";
  actionType?: string;
}

function dateRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

/** Compact one breakdown set into a few readable lines for the GPT evidence pack. */
function summariseRows(label: string, rows: MetaBreakdownRow[], keyOf: (r: MetaBreakdownRow) => string): string {
  if (!rows.length) return `${label}: (no data)`;
  const lines = rows
    .slice(0, 8)
    .map((r) => `  ${keyOf(r)}: spend £${r.spend.toFixed(0)}, ${r.leads} leads, CPL £${r.cpl.toFixed(2)}, CTR ${r.ctr.toFixed(2)}%, freq ${r.frequency.toFixed(1)}, CPM £${r.cpm.toFixed(2)}`)
    .join("\n");
  return `${label}:\n${lines}`;
}

/**
 * Pro-media-buyer heuristic flags (Sprint 10B) computed BEFORE GPT, so the
 * diagnosis is grounded in concrete fatigue/saturation signals rather than the
 * model inferring them. Surfaced into the evidence pack.
 */
function proSignals(campaign: MetaBreakdownRow, ads: MetaBreakdownRow[]): string[] {
  const flags: string[] = [];
  // Creative fatigue: frequency thresholds at the campaign level.
  if (campaign.frequency >= 3.0) {
    flags.push(`Campaign frequency ${campaign.frequency.toFixed(1)} ≥ 3.0 — audience over-exposed; creative needs replacing now.`);
  } else if (campaign.frequency >= 2.5) {
    flags.push(`Campaign frequency ${campaign.frequency.toFixed(1)} ≥ 2.5 — early creative fatigue; line up a refresh.`);
  }
  // Per-ad fatigue — name the worst offenders.
  for (const ad of ads) {
    if (ad.frequency >= 3.0 && ad.impressions > 500) {
      flags.push(`Ad "${ad.name ?? ad.id}" frequency ${ad.frequency.toFixed(1)} — pause/replace this creative.`);
    }
  }
  // Audience-overlap risk: too many ad sets running at once.
  const activeAdsets = ads.length; // ad-level rows ≈ active creatives; coarse proxy
  if (adsetOverlapRisk(activeAdsets)) {
    flags.push(`${activeAdsets} ads/ad sets running — audience-overlap risk; consider consolidating rather than multiplying.`);
  }
  return flags;
}
function adsetOverlapRisk(count: number): boolean {
  return count > 5;
}

export async function runMediaBuyerCycle(
  blueprintId: string,
  tenantId: string,
): Promise<MediaBuyerResult> {
  try {
    // ── Load blueprint ────────────────────────────────────────────────────────
    const blueprint = await prisma.campaignBlueprint.findFirst({
      where:  { id: blueprintId, tenantId },
      select: { status: true, businessName: true, vertical: true, dailyBudgetUsd: true, mediaBuying: true },
    });
    if (!blueprint || blueprint.status !== "live") return { blueprintId, status: "skipped" };

    const mediaBuying    = (blueprint.mediaBuying ?? {}) as Record<string, unknown>;
    const metaAdIds      = (mediaBuying.metaAdIds ?? {}) as Record<string, unknown>;
    const metaCampaignId = typeof metaAdIds.campaignId === "string" ? metaAdIds.campaignId : null;
    const metaAdSetId    = typeof metaAdIds.adSetId    === "string" ? metaAdIds.adSetId    : null;

    const logAction = async (actionType: string, reasoning: string, outcome: string) => {
      await prisma.agentAction.create({
        data: { tenantId, blueprintId, agentName: MEDIA_BUYER_NAME, actionType, reasoning, outcome },
      }).catch((e: unknown) => console.error("[mediaBuyer] log failed:", e));
      void maybeAlertForAction({
        tenantId, blueprintId, clientName: blueprint.businessName,
        agentName: MEDIA_BUYER_NAME, actionType, reasoning, outcome,
      });
    };

    if (!metaCampaignId) {
      await logAction("NO_META_CAMPAIGN", "No Meta campaign is linked to this client yet, so there's nothing for me to optimise. The campaign may still be deploying.", "Skipped");
      return { blueprintId, status: "no_campaign" };
    }

    // ── Client context (brief + Kai's learnings) + guardrails + benchmark ─────
    const ctx = await buildClientContext(blueprintId);
    const guardrails = ctx.guardrails;
    const benchmark = await prisma.verticalProfile
      .findUnique({ where: { vertical: blueprint.vertical }, select: { cplBenchmarkGbp: true } })
      .then((v) => v?.cplBenchmarkGbp ?? null)
      .catch(() => null);

    const currentDailyGbp = blueprint.dailyBudgetUsd * USD_TO_GBP;
    const range = dateRange(OBSERVE_DAYS);

    // ── STEP 1 — OBSERVE ──────────────────────────────────────────────────────
    const [campaignR, adsetR, adR, audienceR] = await Promise.allSettled([
      getCampaignInsightsSummary(metaCampaignId, range, tenantId),
      getAdSetInsights(metaCampaignId, range, tenantId),
      getAdInsights(metaCampaignId, range, tenantId),
      getAudienceInsights(metaCampaignId, range, tenantId),
    ]);

    // Campaign-level is the spine — if even that's unavailable, Meta is down.
    if (campaignR.status !== "fulfilled") {
      await logAction("META_UNAVAILABLE", "I couldn't reach the ad platform this cycle to pull performance data, so I'm holding off on any changes until the next run.", "Could not observe");
      return { blueprintId, status: "meta_unavailable" };
    }
    const campaign: MetaBreakdownRow = campaignR.value;
    const adsets   = adsetR.status === "fulfilled"   ? adsetR.value   : [];
    const ads      = adR.status === "fulfilled"      ? adR.value      : [];
    const audience = audienceR.status === "fulfilled" ? audienceR.value : { demographics: [], placements: [] };

    // ── STEP 2 — DIAGNOSE (GPT-4o causal reasoning) ───────────────────────────
    const proFlags = proSignals(campaign, ads);
    const evidence = [
      `CLIENT: ${blueprint.businessName} (${blueprint.vertical})`,
      `Current daily budget: £${currentDailyGbp.toFixed(2)}`,
      benchmark != null ? `Vertical CPL benchmark: £${benchmark.toFixed(2)}` : `Vertical CPL benchmark: unknown`,
      ``,
      ctx.promptBlock, // includes the brief + Kai's nightly distilledLearnings
      ``,
      `CAMPAIGN (last ${OBSERVE_DAYS}d): spend £${campaign.spend.toFixed(0)}, ${campaign.leads} leads, CPL £${campaign.cpl.toFixed(2)}, CTR ${campaign.ctr.toFixed(2)}%, freq ${campaign.frequency.toFixed(1)}, reach ${campaign.reach}, CPM £${campaign.cpm.toFixed(2)}, ${campaign.impressions} impressions`,
      summariseRows("AD SETS", adsets, (r) => r.name ?? r.id ?? "adset"),
      summariseRows("ADS / CREATIVES", ads, (r) => r.name ?? r.id ?? "ad"),
      summariseRows("AUDIENCE — demographics", audience.demographics, (r) => `${r.age ?? "?"}/${r.gender ?? "?"}`),
      summariseRows("AUDIENCE — placements", audience.placements, (r) => r.publisherPlatform ?? "?"),
      proFlags.length ? `PRO SIGNALS (heuristic, pre-computed):\n${proFlags.map((f) => `  • ${f}`).join("\n")}` : "PRO SIGNALS: none firing.",
    ].join("\n");

    let diagnosis: Diagnosis | null = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.3,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a Meta ads expert with 30 years of experience, managing one client's campaign. " +
                "Diagnose WHY performance is what it is — be specific and back every statement with the data. " +
                "What you know as a pro:\n" +
                "- Never touch a campaign/ad set in the LEARNING phase (it needs ~50 conversions to exit); explain why if you hold.\n" +
                "- Frequency above 2.5 = creative fatigue; above 3.0 = pause/replace the creative immediately.\n" +
                "- CPM rising week-on-week on the same audience = audience saturation.\n" +
                "- 7-day attribution is more reliable than 1-day for high-ticket services — don't over-react to one day.\n" +
                "- Audience overlap between many ad sets wastes budget — consolidate, don't multiply (flag if >5 ad sets).\n" +
                "- Strong hook but low CTR = body-copy problem; weak hook = the opening isn't stopping the scroll.\n" +
                "- Always consider whether underperformance is a campaign issue vs external (seasonality, competitor surge).\n" +
                "Use the PRO SIGNALS block (pre-computed fatigue/overlap flags) as ground truth. " +
                "Then choose exactly ONE action. Respect the client's brief, compliance notes, and learnings. " +
                'Respond ONLY as JSON: {"diagnosis": string, "action": string, "actionType": ' +
                '"PAUSE_CAMPAIGN"|"SCALE_BUDGET"|"RECOMMEND_CREATIVE_REFRESH"|"FLAG_LOW_CTR"|"NO_ACTION", ' +
                '"expectedOutcome": string, "watchFor": string, "confidence": number (0-1)}. ' +
                "PAUSE_CAMPAIGN only if performance is genuinely bad (CPL far above benchmark with real spend, few leads). " +
                "SCALE_BUDGET only if genuinely strong (CPL well below benchmark with volume) AND frequency is healthy (<2.5). " +
                "If frequency ≥3.0, prefer RECOMMEND_CREATIVE_REFRESH over scaling. Prefer NO_ACTION over a low-confidence guess.",
            },
            { role: "user", content: `${evidence}\n\nDiagnose and decide now.` },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(raw) as Partial<Diagnosis>;
        const at = (parsed.actionType ?? "NO_ACTION") as MarcusActionType;
        diagnosis = {
          diagnosis:       typeof parsed.diagnosis === "string" ? parsed.diagnosis : "",
          action:          typeof parsed.action === "string" ? parsed.action : "",
          actionType:      VALID_ACTIONS.has(at) ? at : "NO_ACTION",
          expectedOutcome: typeof parsed.expectedOutcome === "string" ? parsed.expectedOutcome : "",
          watchFor:        typeof parsed.watchFor === "string" ? parsed.watchFor : "",
          confidence:      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
        };
      } catch (err) {
        console.error(`[mediaBuyer] GPT diagnosis failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
      }
    }

    // GPT unavailable/failed → fall back to the proven deterministic engine so the
    // campaign is never left unmanaged.
    if (!diagnosis || !diagnosis.diagnosis) {
      const gr: ClientBriefGuardrails = {
        budgetHardLimitGbp:   guardrails.budgetHardLimitGbp,
        approvalThresholdGbp: guardrails.approvalThresholdGbp,
        briefText:            ctx.promptBlock,
      };
      await runAgentReasoningCycle(blueprintId, tenantId, gr);
      return { blueprintId, status: "fallback" };
    }

    // Full reasoning chain recorded on every action, in plain English.
    const chain =
      `Diagnosis: ${diagnosis.diagnosis}\n` +
      `Action: ${diagnosis.action}\n` +
      `Expected outcome: ${diagnosis.expectedOutcome}\n` +
      `What I'll watch: ${diagnosis.watchFor}\n` +
      `Confidence: ${(diagnosis.confidence * 100).toFixed(0)}%`;

    // ── STEP 3 — DECIDE (guardrails AFTER GPT) ────────────────────────────────

    // Low confidence → never execute; record as a recommendation.
    if (diagnosis.confidence < CONFIDENCE_FLOOR && diagnosis.actionType !== "NO_ACTION") {
      await logAction(diagnosis.actionType, chain, `Recommendation only — confidence ${(diagnosis.confidence * 100).toFixed(0)}% below ${(CONFIDENCE_FLOOR * 100)}% execution threshold`);
      return { blueprintId, status: "recommended", actionType: diagnosis.actionType };
    }

    // Advisory-by-nature actions (no Meta mutation exists for them yet).
    if (!EXECUTABLE.has(diagnosis.actionType)) {
      await logAction(diagnosis.actionType, chain, diagnosis.actionType === "NO_ACTION" ? "Holding steady — no change needed" : "Flagged for review");
      return { blueprintId, status: diagnosis.actionType === "NO_ACTION" ? "no_action" : "recommended", actionType: diagnosis.actionType };
    }

    // ── PAUSE_CAMPAIGN ────────────────────────────────────────────────────────
    if (diagnosis.actionType === "PAUSE_CAMPAIGN") {
      try {
        await pauseCampaign(metaCampaignId, tenantId);
        await logAction("PAUSE_CAMPAIGN", chain, "Campaign paused");
        return { blueprintId, status: "acted", actionType: "PAUSE_CAMPAIGN" };
      } catch (err) {
        await logAction("PAUSE_CAMPAIGN", chain, `Tried to pause but the change didn't go through: ${err instanceof Error ? err.message : "unknown error"}`);
        return { blueprintId, status: "acted", actionType: "PAUSE_CAMPAIGN" };
      }
    }

    // ── SCALE_BUDGET ──────────────────────────────────────────────────────────
    // +20% step, hard-capped at budgetHardLimit; > approvalThreshold needs sign-off.
    const hardLimit = guardrails.budgetHardLimitGbp;
    const proposed  = hardLimit != null ? Math.min(currentDailyGbp * 1.2, hardLimit) : currentDailyGbp * 1.2;
    const increase  = proposed - currentDailyGbp;

    if (increase <= 0.01) {
      await logAction("NO_ACTION", chain, "Already at the budget ceiling — holding.");
      return { blueprintId, status: "no_action", actionType: "NO_ACTION" };
    }

    const threshold = guardrails.approvalThresholdGbp;
    if (threshold != null && increase > threshold) {
      await logAction(
        "NEEDS_APPROVAL",
        `${chain}\n\nProposed: raise daily budget from £${currentDailyGbp.toFixed(2)} to £${proposed.toFixed(2)} (+£${increase.toFixed(2)}/day), which exceeds your £${threshold.toFixed(2)} approval threshold.`,
        "Awaiting your approval to scale",
      );
      return { blueprintId, status: "needs_approval", actionType: "SCALE_BUDGET" };
    }

    try {
      if (metaAdSetId) await updateCampaignBudget(metaAdSetId, Math.round(proposed * 100), tenantId);
      await logAction("SCALE_BUDGET", chain, `Daily budget increased to £${proposed.toFixed(2)}`);
      return { blueprintId, status: "acted", actionType: "SCALE_BUDGET" };
    } catch (err) {
      await logAction("SCALE_BUDGET", chain, `Tried to scale budget but the change didn't go through: ${err instanceof Error ? err.message : "unknown error"}`);
      return { blueprintId, status: "acted", actionType: "SCALE_BUDGET" };
    }
  } catch (err) {
    console.error(`[mediaBuyer] cycle failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { blueprintId, status: "skipped" };
  }
}
