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

import { prisma } from "@/lib/prisma";
import { openai, MODELS } from "@/lib/services/openaiClient";
import { buildClientContext } from "@/lib/agents/clientContext";
import { runAgentReasoningCycle, type ClientBriefGuardrails } from "@/lib/services/agentReasoningService";
import { maybeAlertForAction } from "@/lib/services/alertService";
import { retrieveSimilarCases, formatPrecedentsForPrompt } from "@/lib/intelligence/decisionLibrary";
import { trackDecisionOutcomeInBackground } from "@/lib/intelligence/selfLearningPipeline";
import { computeTrend, detectAnomaly, researchAnomaly, verifyDecision } from "@/lib/agents/marcusReasoning";
import {
  getCampaignInsightsSummary,
  getAdSetInsights,
  getAdInsights,
  getAudienceInsights,
  pauseCampaign,
  pauseAd,
  duplicateAdSet,
  updateCampaignBudget,
  type MetaBreakdownRow,
} from "@/lib/services/metaAdsService";
import { runCreativeRefresh } from "@/lib/agents/creativeRefreshLoop";

const MEDIA_BUYER_NAME = "Marcus";
const USD_TO_GBP = 1 / 1.27;
const CONFIDENCE_FLOOR = 0.7;
const OBSERVE_DAYS = 14;
// Meta's learning phase needs ~50 conversions per optimisation event to exit.
// Below this, PAUSE/SCALE would reset the learner and waste 3-5 days — so those
// actions are downgraded to recommendations. `leads` is our conversion proxy.
const LEARNING_PHASE_CONVERSIONS = 50;
// Don't treat a near-zero-spend campaign as "in learning" worth protecting — it
// has barely started; let normal logic apply once there's real spend behind it.
const LEARNING_PHASE_MIN_SPEND_GBP = 50;

// The only action types Marcus may decide. Anything else is coerced to NO_ACTION.
type MarcusActionType =
  | "PAUSE_CAMPAIGN"
  | "SCALE_BUDGET"
  | "PAUSE_AD"          // kill ONE losing ad (targetId = ad id)
  | "DUPLICATE_ADSET"   // scale a WINNER horizontally (targetId = ad-set id)
  | "RECOMMEND_CREATIVE_REFRESH"
  | "FLAG_LOW_CTR"
  | "NO_ACTION";
const VALID_ACTIONS = new Set<MarcusActionType>([
  "PAUSE_CAMPAIGN", "SCALE_BUDGET", "PAUSE_AD", "DUPLICATE_ADSET", "RECOMMEND_CREATIVE_REFRESH", "FLAG_LOW_CTR", "NO_ACTION",
]);
// Actions Marcus can actually EXECUTE. PAUSE_AD + DUPLICATE_ADSET are targeted and
// safe (the duplicate is created PAUSED, no auto-spend), so they execute autonomously.
const EXECUTABLE = new Set<MarcusActionType>(["PAUSE_CAMPAIGN", "SCALE_BUDGET", "PAUSE_AD", "DUPLICATE_ADSET"]);

interface Diagnosis {
  diagnosis:       string;
  action:          string;        // plain-English description of the chosen action
  actionType:      MarcusActionType;
  targetId?:       string;        // ad id (PAUSE_AD) or ad-set id (DUPLICATE_ADSET)
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
      select: { status: true, businessName: true, vertical: true, targetLocation: true, dailyBudgetUsd: true, mediaBuying: true },
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

    // ── GODLIKE LAYER — trajectory + instant research a human can't do live ────
    // Trajectory: compare this window to the PRIOR window (never pause a recovering
    // campaign; never scale a degrading one). Anomaly: if a metric moved sharply,
    // INSTANTLY research the real world (live web + Meta Ad Library) to find WHY
    // before deciding. Both fail-safe — never block the cycle.
    const priorCampaign = await getCampaignInsightsSummary(
      metaCampaignId, { since: dateRange(OBSERVE_DAYS * 2).since, until: range.since }, tenantId,
    ).catch(() => null);
    const trend = computeTrend(campaign, priorCampaign);
    const anomaly = detectAnomaly(campaign, priorCampaign, benchmark);
    const researchFinding = anomaly.anomalous
      ? await researchAnomaly({
          businessName: blueprint.businessName, city: blueprint.targetLocation ?? "",
          vertical: blueprint.vertical, reasons: anomaly.reasons,
        })
      : "";

    // ── STEP 2 — DIAGNOSE (GPT-4o causal reasoning) ───────────────────────────
    const proFlags = proSignals(campaign, ads);
    const evidence = [
      `CLIENT: ${blueprint.businessName} (${blueprint.vertical})`,
      `Current daily budget: £${currentDailyGbp.toFixed(2)}`,
      benchmark != null ? `Vertical CPL benchmark: £${benchmark.toFixed(2)}` : `Vertical CPL benchmark: unknown`,
      ``,
      ctx.promptBlock, // includes the brief + Kai's nightly distilledLearnings
      ``,
      `CAMPAIGN (last ${OBSERVE_DAYS}d): spend £${campaign.spend.toFixed(0)}, ${campaign.leads} leads/conversions, CPL £${campaign.cpl.toFixed(2)}, CTR ${campaign.ctr.toFixed(2)}%, freq ${campaign.frequency.toFixed(1)}, reach ${campaign.reach}, CPM £${campaign.cpm.toFixed(2)}, ${campaign.impressions} impressions`,
      trend.summary,
      campaign.leads < LEARNING_PHASE_CONVERSIONS && campaign.spend >= LEARNING_PHASE_MIN_SPEND_GBP
        ? `LEARNING PHASE: only ${campaign.leads}/${LEARNING_PHASE_CONVERSIONS} conversions — this campaign is still in Meta's learning phase. Do NOT pause or scale; it needs time to exit. Recommend only.`
        : `LEARNING PHASE: cleared (${campaign.leads} conversions) — normal pause/scale logic applies.`,
      summariseRows("AD SETS", adsets, (r) => r.name ?? r.id ?? "adset"),
      summariseRows("ADS / CREATIVES", ads, (r) => r.name ?? r.id ?? "ad"),
      summariseRows("AUDIENCE — demographics", audience.demographics, (r) => `${r.age ?? "?"}/${r.gender ?? "?"}`),
      summariseRows("AUDIENCE — placements", audience.placements, (r) => r.publisherPlatform ?? "?"),
      proFlags.length ? `PRO SIGNALS (heuristic, pre-computed):\n${proFlags.map((f) => `  • ${f}`).join("\n")}` : "PRO SIGNALS: none firing.",
      researchFinding || "LIVE RESEARCH: not triggered — metrics within normal bands this cycle.",
    ].join("\n");

    // Learning-phase status (hoisted — referenced again in the DECIDE step's hard guardrail).
    const inLearningPhase =
      campaign.leads < LEARNING_PHASE_CONVERSIONS && campaign.spend >= LEARNING_PHASE_MIN_SPEND_GBP;

    // ── CASE-BASED REASONING — retrieve the 5 most similar past cases ──────────
    // A situation key (matched situation↔situation against the library) pulls expert
    // precedents: hand-authored 30-year-veteran cases PLUS Marcus's own decisions,
    // scored 48h later by the self-learning pipeline. CBR is an enhancement, never a
    // dependency — retrieveSimilarCases never throws and returns [] if unavailable.
    const situationText = [
      `${blueprint.vertical} campaign for ${blueprint.businessName}.`,
      `Last ${OBSERVE_DAYS}d: spend £${campaign.spend.toFixed(0)}, ${campaign.leads} conversions, ` +
        `CPL £${campaign.cpl.toFixed(2)}${benchmark != null ? ` vs benchmark £${benchmark.toFixed(2)}` : ""}, ` +
        `CTR ${campaign.ctr.toFixed(2)}%, frequency ${campaign.frequency.toFixed(1)}, CPM £${campaign.cpm.toFixed(2)}.`,
      inLearningPhase ? `Still in Meta's learning phase (${campaign.leads}/${LEARNING_PHASE_CONVERSIONS} conversions).` : `Past the learning phase.`,
      trend.summary,
      proFlags.length ? `Signals: ${proFlags.join(" ")}` : `No fatigue/overlap signals firing.`,
    ].join(" ");
    const precedents = await retrieveSimilarCases(blueprint.vertical, situationText, 5);
    const cbrBlock = formatPrecedentsForPrompt(precedents);

    let diagnosis: Diagnosis | null = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        const completion = await openai.chat.completions.create({
          model: MODELS.primary,
          temperature: 0.2,
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
                '"PAUSE_CAMPAIGN"|"SCALE_BUDGET"|"PAUSE_AD"|"DUPLICATE_ADSET"|"RECOMMEND_CREATIVE_REFRESH"|"FLAG_LOW_CTR"|"NO_ACTION", ' +
                '"targetId": string (REQUIRED for PAUSE_AD = the ad id, and DUPLICATE_ADSET = the ad-set id; use the ids from the AD SETS / ADS evidence rows), ' +
                '"expectedOutcome": string, "watchFor": string, "confidence": number (0-1)}. ' +
                "PAUSE_CAMPAIGN only if the WHOLE campaign is genuinely bad (CPL far above benchmark with real spend, few leads). " +
                "PAUSE_AD when ONE specific ad is the clear loser (high frequency / low CTR / high CPL at AD level while others are fine) — kill just that ad, set targetId to its id; far better than pausing the campaign. " +
                "SCALE_BUDGET only if genuinely strong (CPL well below benchmark with volume) AND frequency is healthy (<2.5). " +
                "DUPLICATE_ADSET to scale a clear WINNER horizontally — set targetId to the best ad set's id; it creates a PAUSED copy to double down (no auto-spend). " +
                "If frequency ≥3.0, prefer RECOMMEND_CREATIVE_REFRESH (Marcus auto-generates + pre-validates a fresh creative) over scaling. Prefer NO_ACTION over a low-confidence guess.\n\n" +
                "Follow this 6-STEP DIAGNOSTIC FRAMEWORK, letting the EXPERT PRECEDENTS inform each step:\n" +
                "1. OBSERVE — read ALL the data (campaign, ad set, ad/creative, audience, frequency, CPM history).\n" +
                "2. HYPOTHESISE — list the plausible causes of the current performance.\n" +
                "3. DISAMBIGUATE — use the evidence and the precedents to rule each cause in or out.\n" +
                "4. DECIDE — choose exactly ONE action within the safety guardrails.\n" +
                "5. PREDICT — state the expected outcome and the specific number you expect to move.\n" +
                "6. MONITOR — state exactly what you'll watch next cycle to confirm or refute the call.\n" +
                "Put steps 1-3 in `diagnosis`, step 4 in `action`/`actionType`, step 5 in `expectedOutcome`, step 6 in `watchFor`.\n\n" +
                "CLIENT-SPECIFIC OVERRIDE: if the evidence contains a MEDIA-BUYER OPTIMISATION PLAYBOOK or WINNING STRATEGY, " +
                "FOLLOW its exact target bands (CPL/CTR/CPM/frequency) and lever priority — they are tuned to THIS client in " +
                "THIS market and OVERRIDE the generic rules above. Read the TREND line and any LIVE RESEARCH: never PAUSE a " +
                "campaign whose CPL is falling fast (it's recovering), never SCALE one whose CPL is rising, and use the live " +
                "research to explain the CAUSE (competitor promo, storm, seasonality) before you act.",
            },
            { role: "system", content: cbrBlock },
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
          targetId:        typeof parsed.targetId === "string" && parsed.targetId.trim() ? parsed.targetId.trim() : undefined,
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

    // LEARNING-PHASE GUARDRAIL (hard, not advisory): never PAUSE or SCALE a
    // campaign still in Meta's learning phase — doing so resets the learner and
    // wastes 3-5 days of optimisation. We approximate "in learning" as fewer than
    // ~50 conversions over the window, with real spend behind it. The prompt warns
    // GPT, but this code makes it impossible to execute the destructive action.
    // (`inLearningPhase` is hoisted to the OBSERVE step, where it also feeds the CBR
    // situation key.)
    if (inLearningPhase && (diagnosis.actionType === "PAUSE_CAMPAIGN" || diagnosis.actionType === "SCALE_BUDGET")) {
      await logAction(
        diagnosis.actionType,
        `${chain}\n\nHELD: campaign is still in Meta's learning phase (${campaign.leads}/${LEARNING_PHASE_CONVERSIONS} conversions). ` +
        `${diagnosis.actionType === "PAUSE_CAMPAIGN" ? "Pausing" : "Scaling"} now would reset the learner and waste days of optimisation, so I'm holding and recommending only.`,
        "Recommendation only — protecting the learning phase",
      );
      return { blueprintId, status: "recommended", actionType: diagnosis.actionType };
    }

    // Low confidence → never execute; record as a recommendation.
    if (diagnosis.confidence < CONFIDENCE_FLOOR && diagnosis.actionType !== "NO_ACTION") {
      await logAction(diagnosis.actionType, chain, `Recommendation only — confidence ${(diagnosis.confidence * 100).toFixed(0)}% below ${(CONFIDENCE_FLOOR * 100)}% execution threshold`);
      return { blueprintId, status: "recommended", actionType: diagnosis.actionType };
    }

    // Advisory-by-nature actions. CREATIVE REFRESH now CLOSES THE LOOP: Marcus
    // auto-generates + pre-validates (15-persona sim) a fresh creative and queues it
    // for one-tap approval, instead of just flagging "refresh needed".
    if (!EXECUTABLE.has(diagnosis.actionType)) {
      if (diagnosis.actionType === "RECOMMEND_CREATIVE_REFRESH") {
        void runCreativeRefresh({ blueprintId, tenantId, reason: diagnosis.diagnosis.slice(0, 300) || "creative fatigue" });
        await logAction(diagnosis.actionType, chain, "Auto-generating a fresh, pre-validated creative for your approval (closed creative-refresh loop)");
        return { blueprintId, status: "recommended", actionType: diagnosis.actionType };
      }
      await logAction(diagnosis.actionType, chain, diagnosis.actionType === "NO_ACTION" ? "Holding steady — no change needed" : "Flagged for review");
      return { blueprintId, status: diagnosis.actionType === "NO_ACTION" ? "no_action" : "recommended", actionType: diagnosis.actionType };
    }

    // ── ADVERSARIAL SELF-CHECK (executable actions only, AFTER the guardrails) ──
    // A skeptical 30-year senior buyer must FAIL to refute the move before money
    // moves — the panel-of-experts pass that beats a single human's snap call.
    // It can VETO (→ recommendation) but never block (defaults to uphold on error).
    const verdict = await verifyDecision({
      action: `${diagnosis.actionType}: ${diagnosis.action}`, chain, evidence, trendSummary: trend.summary,
    });
    if (!verdict.uphold) {
      await logAction(
        diagnosis.actionType,
        `${chain}\n\nHELD by adversarial review: ${verdict.reason}`,
        "Recommendation only — senior-buyer review vetoed immediate execution",
      );
      return { blueprintId, status: "recommended", actionType: diagnosis.actionType };
    }

    // ── PAUSE_AD — kill ONE losing ad, leave the campaign + winners running ────
    if (diagnosis.actionType === "PAUSE_AD") {
      if (!diagnosis.targetId) {
        await logAction("PAUSE_AD", chain, "Recommendation only — no specific ad id was identified to pause.");
        return { blueprintId, status: "recommended", actionType: "PAUSE_AD" };
      }
      try {
        await pauseAd(diagnosis.targetId, tenantId);
        await logAction("PAUSE_AD", chain, `Paused the losing ad ${diagnosis.targetId} — campaign and winning ads keep running.`);
        void trackDecisionOutcomeInBackground({
          blueprintId, tenantId, vertical: blueprint.vertical, metaCampaignId,
          actionType: "PAUSE_AD", situation: situationText, diagnosis: diagnosis.diagnosis, action: diagnosis.action, baselineCpl: campaign.cpl,
        });
        return { blueprintId, status: "acted", actionType: "PAUSE_AD" };
      } catch (err) {
        await logAction("PAUSE_AD", chain, `Tried to pause ad ${diagnosis.targetId} but the change didn't go through: ${err instanceof Error ? err.message : "unknown error"}`);
        return { blueprintId, status: "acted", actionType: "PAUSE_AD" };
      }
    }

    // ── DUPLICATE_ADSET — scale a winner horizontally (PAUSED copy, no auto-spend) ─
    if (diagnosis.actionType === "DUPLICATE_ADSET") {
      const targetAdSet = diagnosis.targetId ?? metaAdSetId;
      if (!targetAdSet) {
        await logAction("DUPLICATE_ADSET", chain, "Recommendation only — no ad set id was identified to duplicate.");
        return { blueprintId, status: "recommended", actionType: "DUPLICATE_ADSET" };
      }
      try {
        const newId = await duplicateAdSet(targetAdSet, tenantId);
        await logAction(
          "DUPLICATE_ADSET", chain,
          newId
            ? `Duplicated winning ad set ${targetAdSet} → ${newId} (PAUSED copy ready to scale — activate to double down).`
            : `Requested a duplicate of ad set ${targetAdSet} (Meta returned no new id).`,
        );
        return { blueprintId, status: "acted", actionType: "DUPLICATE_ADSET" };
      } catch (err) {
        await logAction("DUPLICATE_ADSET", chain, `Tried to duplicate ad set ${targetAdSet} but the change didn't go through: ${err instanceof Error ? err.message : "unknown error"}`);
        return { blueprintId, status: "acted", actionType: "DUPLICATE_ADSET" };
      }
    }

    // ── PAUSE_CAMPAIGN ────────────────────────────────────────────────────────
    if (diagnosis.actionType === "PAUSE_CAMPAIGN") {
      try {
        await pauseCampaign(metaCampaignId, tenantId);
        await logAction("PAUSE_CAMPAIGN", chain, "Campaign paused");
        // Self-learning: trace this executed decision; it's scored 48h later and
        // promoted into the case library as a precedent. Fire-and-forget, never blocks.
        void trackDecisionOutcomeInBackground({
          blueprintId, tenantId, vertical: blueprint.vertical, metaCampaignId,
          actionType: "PAUSE_CAMPAIGN", situation: situationText,
          diagnosis: diagnosis.diagnosis, action: diagnosis.action, baselineCpl: campaign.cpl,
        });
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
      // Self-learning: trace this executed decision; scored 48h later vs real CPL and
      // promoted into the case library. Fire-and-forget, never blocks.
      void trackDecisionOutcomeInBackground({
        blueprintId, tenantId, vertical: blueprint.vertical, metaCampaignId,
        actionType: "SCALE_BUDGET", situation: situationText,
        diagnosis: diagnosis.diagnosis, action: diagnosis.action, baselineCpl: campaign.cpl,
      });
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
