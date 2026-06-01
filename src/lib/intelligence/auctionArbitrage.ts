/**
 * src/lib/intelligence/auctionArbitrage.ts
 * SERVER-SIDE ONLY. Layer 8 (Part 9) — global ad-auction arbitrage.
 *
 * Every 6h, per LIVE blueprint: read current CPM from Meta, append to a rolling
 * 14-day CpmSnapshot history, compute cpmIndex (current / 14-day avg). Then:
 *   - CPM-spike protection: a sustained (>3 days) >50% spike → auto-reduce budget 20%.
 *   - Portfolio rebalance: across a vertical, flag HIGH-COST (index>1.5) vs
 *     LOW-COST (index<0.7) markets → Slack recommendation + outreachAllocation.
 *
 * Country is derived from blueprint.targetLocation (no country column on blueprint).
 * Everything NEVER THROWS.
 */

import { prisma } from "@/lib/prisma";
import { getCampaignInsightsSummary, updateCampaignBudget } from "@/lib/services/metaAdsService";
import { sendAgencyAlert } from "@/lib/services/alertService";
import { detectCountry } from "@/lib/outreach/regional";
import { Prisma } from "@prisma/client";

const USD_TO_GBP = 1 / 1.27;
const HIGH_COST_INDEX = 1.5;   // 50% above 14-day average
const LOW_COST_INDEX = 0.7;    // 30% below
const SPIKE_INDEX = 1.5;       // spike threshold for protection
const SPIKE_DAYS = 3;          // sustained this long → auto-protect

function last7Days(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

export interface ArbitrageReading {
  blueprintId: string;
  vertical: string;
  country: string;
  cpm: number;
  cpmIndex: number;
  action: string;
}

/** Snapshots one blueprint's CPM, computes the index, and applies spike protection. NEVER THROWS. */
export async function snapshotBlueprintCpm(blueprintId: string, tenantId: string): Promise<ArbitrageReading | null> {
  try {
    const bp = await prisma.campaignBlueprint.findFirst({
      where: { id: blueprintId, tenantId, status: "live" },
      select: { vertical: true, targetLocation: true, dailyBudgetUsd: true, mediaBuying: true,
        clientBrief: { select: { budgetHardLimit: true } } },
    });
    if (!bp) return null;
    const country = detectCountry(bp.targetLocation);

    const metaAdIds = (bp.mediaBuying as Record<string, unknown> | null)?.metaAdIds as Record<string, unknown> | undefined;
    const campaignId = typeof metaAdIds?.campaignId === "string" ? metaAdIds.campaignId : null;
    if (!campaignId) return null;

    const insights = await getCampaignInsightsSummary(campaignId, last7Days(), tenantId).catch(() => null);
    const cpm = insights?.cpm ?? 0;
    if (cpm <= 0) return null;

    // 14-day average from prior snapshots (this blueprint).
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const prior = await prisma.cpmSnapshot.findMany({
      where: { blueprintId, createdAt: { gte: since } }, select: { cpm: true },
    });
    const avg = prior.length > 0 ? prior.reduce((a, s) => a + s.cpm, 0) / prior.length : cpm;
    const cpmIndex = avg > 0 ? cpm / avg : 1;

    await prisma.cpmSnapshot.create({
      data: { blueprintId, tenantId, cpm, cpmIndex, country, vertical: bp.vertical },
    }).catch(() => {});

    let action = "observed";

    // ── CPM-spike protection: sustained >50% spike for >3 days → cut budget 20%. ──
    if (cpmIndex > SPIKE_INDEX) {
      const spikeSince = new Date(Date.now() - SPIKE_DAYS * 24 * 60 * 60 * 1000);
      const recent = await prisma.cpmSnapshot.findMany({
        where: { blueprintId, createdAt: { gte: spikeSince } }, select: { cpmIndex: true },
      });
      const sustained = recent.length >= 3 && recent.every((s) => s.cpmIndex > SPIKE_INDEX);
      const adSetId = typeof metaAdIds?.adSetId === "string" ? metaAdIds.adSetId : null;
      if (sustained && adSetId) {
        const curGbp = bp.dailyBudgetUsd * USD_TO_GBP;
        const newGbp = curGbp * 0.8;
        await updateCampaignBudget(adSetId, Math.round((newGbp / USD_TO_GBP) * 100), tenantId).catch(() => {});
        action = `CPM spike sustained ${SPIKE_DAYS}d (index ${cpmIndex.toFixed(2)}) — budget £${curGbp.toFixed(0)}→£${newGbp.toFixed(0)} to protect ROI`;
        await prisma.agentAction.create({ data: {
          tenantId, blueprintId, agentName: "Marcus", actionType: "CPM_SPIKE_PROTECT",
          reasoning: `CPM ${cpmIndex.toFixed(2)}× the 14-day average, sustained ${SPIKE_DAYS}+ days.`, outcome: action,
        } }).catch(() => {});
        await sendAgencyAlert(tenantId, {
          actionType: "CPL_CRITICAL", clientName: campaignId, agentName: "Marcus",
          issue: `CPM spike: ${cpmIndex.toFixed(2)}× the 14-day average in ${country} ${bp.vertical}.`,
          tried: action, blueprintId,
        }).catch(() => {});
      }
    }

    return { blueprintId, vertical: bp.vertical, country, cpm, cpmIndex, action };
  } catch (err) {
    console.error(`[auctionArbitrage] snapshot failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export interface PortfolioRebalance {
  vertical: string;
  highCost: { country: string; index: number }[];
  lowCost: { country: string; index: number }[];
  recommendation: string;
}

/**
 * Across a set of readings, builds a per-vertical portfolio rebalance recommendation
 * and writes an outreachAllocation suggestion to each tenant's AgencyProfile. NEVER THROWS.
 */
export async function buildPortfolioRebalance(readings: ArbitrageReading[]): Promise<PortfolioRebalance[]> {
  const out: PortfolioRebalance[] = [];
  try {
    // Group by vertical → average index per country.
    const byVertical = new Map<string, Map<string, number[]>>();
    for (const r of readings) {
      if (!byVertical.has(r.vertical)) byVertical.set(r.vertical, new Map());
      const m = byVertical.get(r.vertical)!;
      if (!m.has(r.country)) m.set(r.country, []);
      m.get(r.country)!.push(r.cpmIndex);
    }

    for (const [vertical, countries] of Array.from(byVertical.entries())) {
      const avgByCountry = Array.from(countries.entries()).map(([country, idxs]) => ({
        country, index: idxs.reduce((a, b) => a + b, 0) / idxs.length,
      }));
      const highCost = avgByCountry.filter((c) => c.index > HIGH_COST_INDEX).sort((a, b) => b.index - a.index);
      const lowCost = avgByCountry.filter((c) => c.index < LOW_COST_INDEX).sort((a, b) => a.index - b.index);
      if (highCost.length === 0 && lowCost.length === 0) continue;

      const parts: string[] = [];
      for (const h of highCost) parts.push(`${h.country} ${vertical} CPMs up ${Math.round((h.index - 1) * 100)}% — reduce outreach budget.`);
      for (const l of lowCost) parts.push(`${l.country} ${vertical} CPMs down ${Math.round((1 - l.index) * 100)}% — scale outreach now.`);
      out.push({ vertical, highCost, lowCost, recommendation: parts.join(" ") });
    }
  } catch (err) {
    console.error("[auctionArbitrage] rebalance failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

/** Writes a per-tenant outreachAllocation recommendation + Slacks the owner. NEVER THROWS. */
export async function applyAllocationForTenant(tenantId: string, readings: ArbitrageReading[]): Promise<void> {
  try {
    if (readings.length === 0) return;
    // Lower CPM index → more domains. Weight = 1/index, normalised.
    const byCountry = new Map<string, number[]>();
    for (const r of readings) {
      if (!byCountry.has(r.country)) byCountry.set(r.country, []);
      byCountry.get(r.country)!.push(r.cpmIndex);
    }
    const weights = Array.from(byCountry.entries()).map(([country, idxs]) => {
      const avg = idxs.reduce((a, b) => a + b, 0) / idxs.length;
      return { country, raw: 1 / Math.max(avg, 0.1) };
    });
    const total = weights.reduce((a, w) => a + w.raw, 0) || 1;
    const allocation: Record<string, number> = {};
    for (const w of weights) allocation[w.country] = Math.round((w.raw / total) * 100) / 100;

    await prisma.agencyProfile.updateMany({
      where: { tenantId },
      data: { outreachAllocation: allocation as unknown as Prisma.InputJsonValue },
    }).catch(() => {});

    const rebalance = await buildPortfolioRebalance(readings);
    if (rebalance.length > 0) {
      await sendAgencyAlert(tenantId, {
        actionType: "NEEDS_APPROVAL", clientName: "Portfolio", agentName: "Marcus",
        issue: `MARKET ALERT: ${rebalance.map((r) => r.recommendation).join(" ")}`,
        recommended: `Shift sending domains toward cheaper markets: ${JSON.stringify(allocation)}`,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[auctionArbitrage] applyAllocation failed:", err instanceof Error ? err.message : err);
  }
}
