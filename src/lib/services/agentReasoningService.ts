/**
 * src/lib/services/agentReasoningService.ts
 * SERVER-SIDE ONLY.
 *
 * Autonomous agent reasoning loop. Called every 4 hours per live blueprint
 * by the /api/cron/agent-reasoning endpoint.
 *
 * Decision tree (evaluated in priority order — first match wins):
 *   Owner pause instruction                                → PAUSE_CAMPAIGN
 *   A. CPL > maxCpl (owner-set) or 2× benchmark AND leads < 3 AND spend > £10  → PAUSE_CAMPAIGN
 *   B. CPL < 0.75× benchmark AND leads >= minLeadsToScale (owner-set, else 5)   → SCALE_BUDGET (+20%)
 *   C. leads = 0 AND spend > £5                           → RECOMMEND_CREATIVE_REFRESH
 *   D. CTR < 0.5% AND impressions > 1000                  → FLAG_LOW_CTR
 *   E. None of the above                                  → NO_ACTION
 */

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { ServiceVertical } from "@/enums/campaignEnums";
import { getVerticalInsightsSummary, getSeasonalStrength } from "@/lib/services/insightsService";
import {
  getCampaignInsights,
  pauseCampaign,
  updateCampaignBudget,
} from "@/lib/services/metaAdsService";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

// Meta Insights API returns numeric fields as strings
interface MetaInsightsRow {
  spend:       string;
  impressions: string;
  ctr:         string;
  actions?:    Array<{ action_type: string; value: string }>;
}

interface MetaInsightsResponse {
  data?: MetaInsightsRow[];
}

// ── Instruction overrides ─────────────────────────────────────────────────────

interface InstructionOverrides {
  shouldPause:      boolean;
  shouldScale:      boolean;
  maxCpl:           number | null;
  minLeadsToScale:  number | null;
  customReasoning:  string;
}

const defaultOverrides: InstructionOverrides = {
  shouldPause:     false,
  shouldScale:     false,
  maxCpl:          null,
  minLeadsToScale: null,
  customReasoning: "",
};

async function parseInstructionsWithGPT(
  instructions: string,
  context: {
    currentCpl:   number;
    benchmarkCpl: number;
    leads:        number;
    spend:        number;
    impressions:  number;
  }
): Promise<InstructionOverrides> {
  if (!process.env.OPENAI_API_KEY) return { ...defaultOverrides };

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an AI media buyer reading instructions from an agency owner about how to manage a specific client's ad campaign. Extract the operating rules from their instructions and return a JSON object. Be generous in interpretation — if they say 'keep CPL under £40' set maxCpl to 40. If they say 'scale when performing well' set minLeadsToScale to 5.",
        },
        {
          role: "user",
          content:
            `Instructions:\n${instructions}\n\nCurrent metrics: CPL £${context.currentCpl.toFixed(2)}, benchmark £${context.benchmarkCpl.toFixed(2)}, ${context.leads} leads in 48h, £${context.spend.toFixed(2)} spent.\n\nReturn JSON only: { "shouldPause": boolean, "shouldScale": boolean, "maxCpl": number | null, "minLeadsToScale": number | null, "customReasoning": string }`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<InstructionOverrides>;

    return {
      shouldPause:     typeof parsed.shouldPause     === "boolean" ? parsed.shouldPause     : false,
      shouldScale:     typeof parsed.shouldScale     === "boolean" ? parsed.shouldScale     : false,
      maxCpl:          typeof parsed.maxCpl          === "number"  ? parsed.maxCpl          : null,
      minLeadsToScale: typeof parsed.minLeadsToScale === "number"  ? parsed.minLeadsToScale : null,
      customReasoning: typeof parsed.customReasoning === "string"  ? parsed.customReasoning : "",
    };
  } catch {
    return { ...defaultOverrides };
  }
}

// ── Client-brief guardrails (Build 1: Dual Agent Architecture) ─────────────────
// Injected by the Client Account-Manager agent (clientAgent.ts) so the reasoning
// loop manages each client to its brief and respects budget/approval limits.
export interface ClientBriefGuardrails {
  budgetHardLimitGbp?:   number | null;  // never scale daily budget above this
  approvalThresholdGbp?: number | null;  // a budget change above this needs owner approval
  briefText?:            string | null;  // brief context fed into instruction parsing
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runAgentReasoningCycle(
  blueprintId: string,
  tenantId: string,
  brief?: ClientBriefGuardrails
): Promise<void> {
  // ── 1. Fetch blueprint ────────────────────────────────────────────────────
  const blueprint = await prisma.campaignBlueprint.findUnique({
    where:  { id: blueprintId },
    select: {
      id:             true,
      tenantId:       true,
      status:         true,
      vertical:       true,
      businessName:   true,
      dailyBudgetUsd: true,
      mediaBuying:    true,
      agentActions: {
        orderBy: { executedAt: "desc" },
        take:    10,
      },
    },
  });

  // ── 2. Early exit if not live ─────────────────────────────────────────────
  if (!blueprint || blueprint.status !== "live") return;

  // ── 3. Get agent name ─────────────────────────────────────────────────────
  const rep = await prisma.aIRepresentative.findUnique({
    where:  { blueprintId },
    select: { repName: true },
  });
  const agentName = rep?.repName ?? "Your Agent";

  // ── 4. Get vertical benchmark + instructions in parallel ──────────────────
  const [verticalInsights, instructions] = await Promise.all([
    getVerticalInsightsSummary(blueprint.vertical as ServiceVertical),
    prisma.agentInstruction.findMany({
      where:   { blueprintId, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // ── 5. Extract Meta IDs from mediaBuying JSON ─────────────────────────────
  const mediaBuying  = blueprint.mediaBuying as Record<string, unknown>;
  const metaAdIds    = (mediaBuying.metaAdIds ?? {}) as Record<string, unknown>;
  const metaCampaignId = typeof metaAdIds.campaignId === "string" ? metaAdIds.campaignId : null;
  const metaAdSetId    = typeof metaAdIds.adSetId    === "string" ? metaAdIds.adSetId    : null;

  if (!metaCampaignId) {
    console.log(`[agentReasoning] ${blueprintId}: No Meta campaign linked — skipping.`);
    await prisma.agentAction.create({
      data: {
        tenantId,
        blueprintId,
        agentName,
        actionType: "NO_META_CAMPAIGN",
        reasoning:  "No Meta campaign ID linked to this blueprint. Campaign may not be fully deployed.",
        outcome:    "Skipped",
      },
    });
    return;
  }

  // ── 6. Fetch Meta campaign insights (last 48h) ────────────────────────────
  const now       = new Date();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  let insightsRaw: MetaInsightsResponse;
  try {
    insightsRaw = (await getCampaignInsights(
      metaCampaignId,
      { since: formatDate(twoDaysAgo), until: formatDate(now) },
      tenantId
    )) as MetaInsightsResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[agentReasoning] ${blueprintId}: Meta API unavailable — ${msg}`);
    await prisma.agentAction.create({
      data: {
        tenantId,
        blueprintId,
        agentName,
        actionType: "META_UNAVAILABLE",
        reasoning:  `Meta Ads API unavailable: ${msg}`,
        outcome:    "Skipped — will retry next cycle",
      },
    });
    return;
  }

  // ── 7. Parse insights ─────────────────────────────────────────────────────
  const row: MetaInsightsRow = insightsRaw.data?.[0] ?? {
    spend: "0", impressions: "0", ctr: "0",
  };

  const spend       = parseFloat(row.spend       ?? "0");
  const impressions = parseInt(row.impressions   ?? "0", 10);
  const ctr         = parseFloat(row.ctr         ?? "0");

  const leadAction  = (row.actions ?? []).find(a => a.action_type === "lead");
  const leads       = leadAction ? parseInt(leadAction.value ?? "0", 10) : 0;

  // ── 8. Compute CPL and benchmark ─────────────────────────────────────────
  const currentCpl   = spend / Math.max(leads, 1);
  const benchmarkCpl = verticalInsights.benchmarkCplGbp;

  console.log(
    `[agentReasoning] ${blueprint.businessName} (${blueprintId}): ` +
    `spend=£${spend.toFixed(2)}, leads=${leads}, CPL=£${currentCpl.toFixed(2)}, ` +
    `benchmark=£${benchmarkCpl.toFixed(2)}, CTR=${(ctr * 100).toFixed(2)}%, impressions=${impressions}`
  );

  // ── 9. Parse owner instructions via GPT (with client-brief context) ───────
  // The client brief is injected ahead of standing instructions so the agent
  // reasons within the brief (ideal/bad leads, USPs, brand tone, limits).
  const briefText = brief?.briefText?.trim() ?? "";
  const combinedInstructions = [briefText, ...instructions.map(i => i.instruction)]
    .filter(s => s.trim().length > 0)
    .join("\n");

  let overrides: InstructionOverrides = { ...defaultOverrides };
  if (combinedInstructions.length > 0) {
    overrides = await parseInstructionsWithGPT(combinedInstructions, {
      currentCpl, benchmarkCpl, leads, spend, impressions,
    });
  }

  // ── Helper: persist a decision ────────────────────────────────────────────
  const logAction = async (params: {
    actionType:    string;
    reasoning:     string;
    outcome:       string;
    metricBefore?: number;
    metricAfter?:  number;
  }): Promise<void> => {
    await prisma.agentAction.create({
      data: { tenantId, blueprintId, agentName, ...params },
    });
    console.log(`[agentReasoning] ${blueprintId}: ${params.actionType} — ${params.outcome}`);
  };

  // ── Decision tree (first match wins) ─────────────────────────────────────

  // OWNER INSTRUCTION — explicit pause
  if (overrides.shouldPause) {
    await pauseCampaign(metaCampaignId, tenantId);
    await logAction({
      actionType:   "PAUSE_CAMPAIGN",
      reasoning:    overrides.customReasoning || "Pausing per agency owner instruction.",
      outcome:      "Campaign paused per standing instruction",
      metricBefore: currentCpl,
    });
    return;
  }

  // DECISION A — CPL too high: use maxCpl override if set, else 2× benchmark
  const pauseCplThreshold = overrides.maxCpl ?? benchmarkCpl * 2.0;
  if (currentCpl > pauseCplThreshold && leads < 3 && spend > 10) {
    await pauseCampaign(metaCampaignId, tenantId);
    await logAction({
      actionType:   "PAUSE_CAMPAIGN",
      reasoning:    `CPL of £${currentCpl.toFixed(2)} exceeds the £${pauseCplThreshold.toFixed(2)} threshold (${overrides.maxCpl ? "set by owner instruction" : "2× vertical benchmark"}) with only ${leads} leads. Pausing to prevent wasted spend.`,
      outcome:      "Campaign paused",
      metricBefore: currentCpl,
    });
    return;
  }

  // DECISION B — Strong performance: scale budget, respecting client-brief limits
  const scaleLeadsThreshold = overrides.minLeadsToScale ?? 5;
  if (currentCpl < benchmarkCpl * 0.75 && leads >= scaleLeadsThreshold) {
    const currentBudget = blueprint.dailyBudgetUsd; // daily budget (native unit, treated as £)
    const hardLimit     = brief?.budgetHardLimitGbp ?? 200; // default £200/day ceiling

    // Never scale above the brief's hard budget limit.
    if (currentBudget >= hardLimit) {
      await logAction({
        actionType:   "NO_ACTION",
        reasoning:    `CPL of £${currentCpl.toFixed(2)} is strong, but the daily budget (£${currentBudget.toFixed(2)}) is already at the hard limit of £${hardLimit.toFixed(2)}/day. Holding — scaling further needs your approval.`,
        outcome:      "At budget ceiling",
        metricBefore: currentCpl,
      });
      return;
    }

    const proposedBudget    = Math.min(currentBudget * 1.2, hardLimit);
    const increase          = proposedBudget - currentBudget;
    const approvalThreshold = brief?.approvalThresholdGbp ?? null;

    // A change above the approval threshold is flagged, not executed.
    if (approvalThreshold !== null && increase > approvalThreshold) {
      await logAction({
        actionType:   "NEEDS_APPROVAL",
        reasoning:    `CPL of £${currentCpl.toFixed(2)} justifies scaling the daily budget from £${currentBudget.toFixed(2)} to £${proposedBudget.toFixed(2)} (+£${increase.toFixed(2)}/day), which exceeds your £${approvalThreshold.toFixed(2)} approval threshold. Awaiting your go-ahead.`,
        outcome:      "Flagged for approval",
        metricBefore: currentCpl,
      });
      return;
    }

    const newBudgetCents = Math.round(proposedBudget * 100);
    if (metaAdSetId) {
      await updateCampaignBudget(metaAdSetId, newBudgetCents, tenantId);
    }

    await logAction({
      actionType:   "SCALE_BUDGET",
      reasoning:    `CPL of £${currentCpl.toFixed(2)} is 25% below the £${benchmarkCpl.toFixed(2)} benchmark with ${leads} leads. Scaling budget to £${proposedBudget.toFixed(2)}/day.`,
      outcome:      `Daily budget increased to £${proposedBudget.toFixed(2)}`,
      metricBefore: currentCpl,
      metricAfter:  currentCpl,
    });
    return;
  }

  // DECISION C — No leads with real spend: flag for creative refresh
  if (leads === 0 && spend > 5) {
    await logAction({
      actionType: "RECOMMEND_CREATIVE_REFRESH",
      reasoning:  `£${spend.toFixed(2)} spent in 48h with zero leads. Creative may need refreshing or targeting is too narrow.`,
      outcome:    "Flagged for creative review",
    });
    return;
  }

  // DECISION D — Low CTR after meaningful impressions: creative fatigue
  if (ctr < 0.005 && impressions > 1000) {
    await logAction({
      actionType: "FLAG_LOW_CTR",
      reasoning:  `CTR of ${(ctr * 100).toFixed(2)}% is below the 0.5% threshold after ${impressions} impressions. Likely creative fatigue.`,
      outcome:    "Flagged for new creative",
    });
    return;
  }

  // DECISION E — All normal: log monitoring heartbeat
  await logAction({
    actionType: "NO_ACTION",
    reasoning:  `Campaign within normal parameters. CPL £${currentCpl.toFixed(2)} vs benchmark £${benchmarkCpl.toFixed(2)}. No intervention needed.`,
    outcome:    "Monitoring",
  });

  // Sprint 13: additive proactive suggestion — independent of the decision above.
  // If the current month is historically strong for this vertical, recommend a new
  // campaign. Deduped to once per ~20h so the 4-hourly cycle doesn't spam.
  try {
    const recentSuggestion = blueprint.agentActions.find(
      (a) => a.actionType === "CAMPAIGN_SUGGESTION" &&
             a.executedAt.getTime() > Date.now() - 20 * 60 * 60 * 1000
    );
    if (!recentSuggestion) {
      const seasonal = await getSeasonalStrength(blueprint.vertical as ServiceVertical);
      if (seasonal.isStrong) {
        await logAction({
          actionType: "CAMPAIGN_SUGGESTION",
          reasoning:
            `Based on ${blueprint.vertical} data, ${seasonal.monthName} is a strong month for ${blueprint.vertical} ` +
            `— CPL runs about ${seasonal.efficiencyPct}% below the yearly average. ` +
            `Recommend launching a new campaign to capture the seasonal demand.`,
          outcome: "Suggested",
        });
      }
    }
  } catch (err) {
    console.error("[agentReasoning] seasonal suggestion failed:", err instanceof Error ? err.message : err);
  }
}
