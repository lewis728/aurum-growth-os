// src/lib/services/insightsService.ts
// Vertical Intelligence Insights — reads aggregated PerformanceDataStore
// from VerticalProfile.performanceData.
//
// Golden rules:
//   - ALL functions NEVER throw — return sensible defaults on error
//   - No tier checks anywhere
//   - No PII access — reads only anonymised aggregate data

import { prisma } from "@/lib/prisma";
import { ServiceVertical } from "@/enums/campaignEnums";
import type { PerformanceDataStore } from "@/lib/services/verticalLibraryService";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnonymisedCampaignEntry {
  vertical:              string;
  creativeStyle:         string;
  dailyBudgetRange:      string;
  geographyType:         string;
  finalCplGbp:           number;
  avgCtr:                number;
  callToBookRate:        number;
  showRate:              number;
  campaignDurationDays:  number;
  recordedAt:            string; // ISO date
}

export interface VerticalInsightsSummary {
  vertical:                ServiceVertical;
  benchmarkCplGbp:         number;
  topCreativeStyle:        string | null;
  avgCallToBookRate:       number;
  avgShowRate:             number;
  recommendedBudgetRange:  string;
  sampleSize:              number;
  lastUpdated:             string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCampaigns(performanceData: unknown): AnonymisedCampaignEntry[] {
  if (!performanceData || typeof performanceData !== "object") return [];
  const store = performanceData as Partial<PerformanceDataStore>;
  if (!Array.isArray(store.campaigns)) return [];
  return store.campaigns as unknown as AnonymisedCampaignEntry[];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function mode(values: string[]): string | null {
  if (values.length === 0) return null;
  const freq: Record<string, number> = {};
  for (const v of values) freq[v] = (freq[v] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ── getVerticalCPLBenchmark ───────────────────────────────────────────────────

/**
 * Returns the live 90-day rolling average CPL for a vertical.
 * Falls back to the static cplBenchmarkGbp if fewer than 5 campaigns exist.
 * NEVER throws.
 */
export async function getVerticalCPLBenchmark(vertical: ServiceVertical): Promise<number> {
  try {
    const profile = await prisma.verticalProfile.findUnique({
      where:  { vertical: vertical as string },
      select: { cplBenchmarkGbp: true, performanceData: true },
    });

    if (!profile) return 0;

    const campaigns = parseCampaigns(profile.performanceData);

    if (campaigns.length < 5) {
      return profile.cplBenchmarkGbp;
    }

    // Rolling 90-day average
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recent = campaigns.filter((c) => {
      if (!c.recordedAt) return false;
      return new Date(c.recordedAt) >= cutoff;
    });

    const cpls = recent
      .map((c) => c.finalCplGbp)
      .filter((v) => typeof v === "number" && !isNaN(v) && v > 0);

    if (cpls.length === 0) return profile.cplBenchmarkGbp;

    return Math.round(avg(cpls) * 100) / 100;
  } catch (err) {
    console.warn(`[insightsService] getVerticalCPLBenchmark error for ${vertical as string}:`, err);
    return 0;
  }
}

// ── getCreativeStylePerformance ───────────────────────────────────────────────

/**
 * Returns creative style performance breakdown for a vertical.
 * Only includes styles with >= 3 campaigns.
 * Sorted by avgCpl ascending (lowest CPL first).
 * NEVER throws.
 */
export async function getCreativeStylePerformance(
  vertical: ServiceVertical
): Promise<Array<{ style: string; avgCpl: number; avgCtr: number; sampleSize: number }>> {
  try {
    const profile = await prisma.verticalProfile.findUnique({
      where:  { vertical: vertical as string },
      select: { performanceData: true },
    });

    if (!profile) return [];

    const campaigns = parseCampaigns(profile.performanceData);

    // Group by creativeStyle
    const groups: Record<string, AnonymisedCampaignEntry[]> = {};
    for (const c of campaigns) {
      const style = c.creativeStyle ?? "unknown";
      if (!groups[style]) groups[style] = [];
      groups[style].push(c);
    }

    const result: Array<{ style: string; avgCpl: number; avgCtr: number; sampleSize: number }> = [];

    for (const [style, entries] of Object.entries(groups)) {
      if (entries.length < 3) continue;

      const cpls = entries.map((e) => e.finalCplGbp).filter((v) => typeof v === "number" && !isNaN(v));
      const ctrs = entries.map((e) => e.avgCtr).filter((v) => typeof v === "number" && !isNaN(v));

      result.push({
        style,
        avgCpl:     Math.round(avg(cpls) * 100) / 100,
        avgCtr:     Math.round(avg(ctrs) * 10000) / 10000,
        sampleSize: entries.length,
      });
    }

    return result.sort((a, b) => a.avgCpl - b.avgCpl);
  } catch (err) {
    console.warn(`[insightsService] getCreativeStylePerformance error for ${vertical as string}:`, err);
    return [];
  }
}

// ── getVerticalInsightsSummary ────────────────────────────────────────────────

/**
 * Returns a combined VerticalInsightsSummary for a vertical.
 * All fields populated — uses 0 / null for missing data.
 * NEVER throws.
 */
export async function getVerticalInsightsSummary(
  vertical: ServiceVertical
): Promise<VerticalInsightsSummary> {
  const defaultSummary: VerticalInsightsSummary = {
    vertical,
    benchmarkCplGbp:        0,
    topCreativeStyle:       null,
    avgCallToBookRate:      0,
    avgShowRate:            0,
    recommendedBudgetRange: "low",
    sampleSize:             0,
    lastUpdated:            null,
  };

  try {
    const [benchmarkCplGbp, creativeStyles, profile] = await Promise.all([
      getVerticalCPLBenchmark(vertical),
      getCreativeStylePerformance(vertical),
      prisma.verticalProfile.findUnique({
        where:  { vertical: vertical as string },
        select: { performanceData: true },
      }),
    ]);

    if (!profile) return defaultSummary;

    const campaigns = parseCampaigns(profile.performanceData);
    const store     = profile.performanceData as Partial<PerformanceDataStore>;

    // Top creative style — lowest CPL with >= 3 samples
    const topCreativeStyle = creativeStyles.length > 0 ? creativeStyles[0].style : null;

    // Avg call-to-book and show rates
    const callToBookRates = campaigns
      .map((c) => c.callToBookRate)
      .filter((v) => typeof v === "number" && !isNaN(v));
    const showRates = campaigns
      .map((c) => c.showRate)
      .filter((v) => typeof v === "number" && !isNaN(v));

    // Recommended budget range — most common range in top quartile by CPL
    const sorted = [...campaigns]
      .filter((c) => typeof c.finalCplGbp === "number" && !isNaN(c.finalCplGbp))
      .sort((a, b) => a.finalCplGbp - b.finalCplGbp);

    const topQuartileCount = Math.max(1, Math.floor(sorted.length / 4));
    const topQuartile      = sorted.slice(0, topQuartileCount);
    const budgetRanges     = topQuartile.map((c) => c.dailyBudgetRange).filter(Boolean);
    const recommendedBudgetRange = mode(budgetRanges) ?? "low";

    return {
      vertical,
      benchmarkCplGbp,
      topCreativeStyle,
      avgCallToBookRate:      Math.round(avg(callToBookRates) * 10000) / 10000,
      avgShowRate:            Math.round(avg(showRates) * 10000) / 10000,
      recommendedBudgetRange,
      sampleSize:             campaigns.length,
      lastUpdated:            store.lastUpdated ?? null,
    };
  } catch (err) {
    console.warn(`[insightsService] getVerticalInsightsSummary error for ${vertical as string}:`, err);
    return defaultSummary;
  }
}
