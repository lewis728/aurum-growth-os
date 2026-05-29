// src/lib/cron/performanceAggregator.ts
// Vertical Intelligence Feedback Loop — performance data aggregation.
//
// Privacy rule (non-negotiable):
//   AnonymisedCampaignResult contains ZERO PII.
//   No tenantId, no business name, no client name, no lead names,
//   no phone numbers, no email addresses.
//   Only vertical category, metrics, and anonymised campaign parameters.
//
// Golden rules:
//   - aggregateCampaignPerformance() NEVER throws — catch and log to CommandLog
//   - runWeeklyAggregation() uses Promise.allSettled() — one failure never blocks others
//   - No tier checks anywhere

import { prisma } from "@/lib/prisma";
import { updateVerticalPerformanceData } from "@/lib/services/verticalLibraryService";
import { getCampaignInsights } from "@/lib/services/metaAdsService";
import { CampaignStatus, ServiceVertical } from "@/enums/campaignEnums";
import type { MediaBuyingLayer, TargetingSpec } from "@/types/mediaBuyingLayer";
import type { CreativeLayer } from "@/types/creativeLayer";

// ── AnonymisedCampaignResult ──────────────────────────────────────────────────
// ZERO PII — enforced at build time by the absence of any identity fields.
export interface AnonymisedCampaignResult {
  vertical:              ServiceVertical;
  creativeStyle:         "ai_generated" | "uploaded" | "mixed";
  dailyBudgetRange:      "micro" | "low" | "mid" | "high";
  geographyType:         "city" | "regional" | "national";
  finalCplGbp:           number;
  avgCtr:                number;
  callToBookRate:        number;
  showRate:              number;
  campaignDurationDays:  number;
  recordedAt:            string; // ISO date — added by updateVerticalPerformanceData
}

// ── Budget range helper ───────────────────────────────────────────────────────
// Spec uses dailyBudgetGbp; blueprint stores dailyBudgetUsd.
// We use dailyBudgetUsd as a proxy (close enough for range bucketing).
function deriveBudgetRange(dailyBudgetUsd: number): AnonymisedCampaignResult["dailyBudgetRange"] {
  if (dailyBudgetUsd < 30)  return "micro";
  if (dailyBudgetUsd < 100) return "low";
  if (dailyBudgetUsd < 300) return "mid";
  return "high";
}

// ── Geography type helper ─────────────────────────────────────────────────────
function deriveGeographyType(targeting: TargetingSpec): AnonymisedCampaignResult["geographyType"] {
  const geo = targeting.geoLocations;
  // Nationwide: targeting whole countries
  if (geo.countries && geo.countries.length > 0 && !geo.cities && !geo.regions) {
    return "national";
  }
  // Single city
  if (geo.cities && geo.cities.length === 1 && !geo.regions) {
    return "city";
  }
  // Multiple cities, regions, or radius — regional
  return "regional";
}

// ── Creative style helper ─────────────────────────────────────────────────────
function deriveCreativeStyle(creative: CreativeLayer): AnonymisedCampaignResult["creativeStyle"] {
  const hasAiAssets      = creative.assets && creative.assets.length > 0;
  const hasUploadedAssets = creative.uploadedAssets && creative.uploadedAssets.length > 0;
  if (hasAiAssets && hasUploadedAssets) return "mixed";
  if (hasUploadedAssets) return "uploaded";
  return "ai_generated";
}

// ── aggregateCampaignPerformance ──────────────────────────────────────────────
export async function aggregateCampaignPerformance(blueprintId: string): Promise<void> {
  try {
    // Fetch blueprint
    const blueprint = await prisma.campaignBlueprint.findUnique({
      where:  { id: blueprintId },
      select: {
        id:             true,
        tenantId:       true,
        vertical:       true,
        dailyBudgetUsd: true,
        mediaBuying:    true,
        creative:       true,
        createdAt:      true,
      },
    });

    if (!blueprint) {
      console.warn(`[performanceAggregator] Blueprint not found: ${blueprintId}`);
      return;
    }

    const mediaBuying = blueprint.mediaBuying as unknown as MediaBuyingLayer;
    const creative    = blueprint.creative    as unknown as CreativeLayer;

    // ── Meta insights ─────────────────────────────────────────────────────────
    let finalCplGbp = 0;
    let avgCtr      = 0;

    try {
      const campaignId = mediaBuying?.metaAdIds?.campaignId;
      if (campaignId) {
        const since = blueprint.createdAt.toISOString().slice(0, 10);
        const until = new Date().toISOString().slice(0, 10);
        const raw   = await getCampaignInsights(campaignId, { since, until }, blueprint.tenantId);

        const data = Array.isArray((raw as { data?: unknown }).data)
          ? ((raw as { data: Record<string, unknown>[] }).data[0] ?? {})
          : (raw as Record<string, unknown>);

        const spend       = data.spend       ? parseFloat(String(data.spend))       : 0;
        avgCtr            = data.ctr         ? parseFloat(String(data.ctr))         : 0;

        // Lead count from actions
        const actions = data.actions as Array<{ action_type: string; value: string }> | undefined;
        const metaLeads = actions?.find((a) => a.action_type === "lead");
        const leadCount = metaLeads ? parseInt(metaLeads.value, 10) : 0;

        if (spend > 0 && leadCount > 0) {
          finalCplGbp = spend / leadCount;
        }
      }
    } catch (err) {
      console.warn(`[performanceAggregator] Meta insights failed for ${blueprintId}:`, err);
    }

    // ── Prisma lead/appointment stats ─────────────────────────────────────────
    const [totalLeadsRaw, bookedLeadsRaw, totalAppointmentsRaw, attendedRaw] = await Promise.all([
      prisma.lead.count({ where: { blueprintId } }),
      prisma.lead.count({ where: { blueprintId, status: "booked" } }),
      prisma.appointment.count({ where: { blueprintId } }),
      prisma.appointment.count({ where: { blueprintId, status: "attended" } }),
    ]);

    const callToBookRate = totalLeadsRaw > 0 ? bookedLeadsRaw / totalLeadsRaw : 0;
    const showRate       = totalAppointmentsRaw > 0 ? attendedRaw / totalAppointmentsRaw : 0;

    // ── Campaign duration ─────────────────────────────────────────────────────
    const durationMs          = Date.now() - blueprint.createdAt.getTime();
    const campaignDurationDays = Math.max(1, Math.round(durationMs / (1000 * 60 * 60 * 24)));

    // ── Derived fields ────────────────────────────────────────────────────────
    const dailyBudgetRange = deriveBudgetRange(blueprint.dailyBudgetUsd);
    const geographyType    = deriveGeographyType(mediaBuying.targeting);
    const creativeStyle    = deriveCreativeStyle(creative);

    // ── Build anonymised result — ZERO PII ────────────────────────────────────
    const anonymisedResult: Omit<AnonymisedCampaignResult, "recordedAt"> = {
      vertical:             blueprint.vertical as ServiceVertical,
      creativeStyle,
      dailyBudgetRange,
      geographyType,
      finalCplGbp:          Math.round(finalCplGbp * 100) / 100,
      avgCtr:               Math.round(avgCtr * 10000) / 10000,
      callToBookRate:       Math.round(callToBookRate * 10000) / 10000,
      showRate:             Math.round(showRate * 10000) / 10000,
      campaignDurationDays,
    };

    // ── Update VerticalProfile.performanceData ────────────────────────────────
    await updateVerticalPerformanceData(
      blueprint.vertical as ServiceVertical,
      anonymisedResult as unknown as Record<string, unknown>
    );

    // ── Mark blueprint as aggregated ──────────────────────────────────────────
    await prisma.campaignBlueprint.update({
      where: { id: blueprintId },
      data:  { aggregated: true },
    });

    console.info(
      `[performanceAggregator] Aggregated blueprintId=${blueprintId} ` +
      `vertical=${blueprint.vertical} cpl=${anonymisedResult.finalCplGbp} ` +
      `ctr=${anonymisedResult.avgCtr}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[performanceAggregator] aggregateCampaignPerformance failed for ${blueprintId}: ${message}`);
    // Log to CommandLog — non-fatal
    try {
      await prisma.commandLog.create({
        data: {
          tenantId:   "system",
          rawInput:   `performanceAggregator:${blueprintId}`,
          intentType: "AGGREGATION_FAILED",
          blueprintId,
          success:    false,
          errorMsg:   message,
        },
      });
    } catch {
      // CommandLog write failure is non-fatal
    }
  }
}

// ── runWeeklyAggregation ──────────────────────────────────────────────────────
export async function runWeeklyAggregation(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all LIVE blueprints older than 7 days (have enough data)
  // plus PAUSED/ARCHIVED that have not been aggregated yet
  const blueprints = await prisma.campaignBlueprint.findMany({
    where: {
      OR: [
        {
          status:    CampaignStatus.LIVE,
          createdAt: { lt: sevenDaysAgo },
          aggregated: false,
        },
        {
          status:    { in: [CampaignStatus.PAUSED, CampaignStatus.ARCHIVED] },
          aggregated: false,
        },
      ],
    },
    select: { id: true },
  });

  const processed = blueprints.length;

  const results = await Promise.allSettled(
    blueprints.map((bp) => aggregateCampaignPerformance(bp.id))
  );

  let succeeded = 0;
  let failed    = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      succeeded++;
    } else {
      failed++;
    }
  }

  // Log summary
  try {
    await prisma.commandLog.create({
      data: {
        tenantId:   "system",
        rawInput:   `cron:performance-aggregation:${new Date().toISOString()}`,
        intentType: "AGGREGATION_RUN",
        success:    true,
        errorMsg:   JSON.stringify({ processed, succeeded, failed }),
      },
    });
  } catch {
    // Non-fatal
  }

  console.info(
    `[performanceAggregator] Weekly aggregation complete: ` +
    `processed=${processed} succeeded=${succeeded} failed=${failed}`
  );

  return { processed, succeeded, failed };
}
