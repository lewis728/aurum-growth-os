/**
 * src/lib/services/metaAdsService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Handles all Meta Ads Graph API v20.0 operations.
 * Every external call is wrapped in withRetry() per GR-02.
 *
 * IMPORTANT — Tenant token model (Phase 2 P01):
 *   All public functions now accept a `tenantId` parameter.
 *   The tenant's own decrypted access token is fetched via
 *   getMetaAccessToken(tenantId) for every request.
 *   The global META_ACCESS_TOKEN env var is no longer used for
 *   tenant operations — Aurum operates as an authorised operator
 *   on the client's own ad account.
 *
 *   Ad account ID, page ID, and pixel ID are also read from the
 *   tenant's MetaConnection row rather than from env vars.
 */

import { withRetry } from "@/lib/utils/withRetry";
import { getMetaAccessToken } from "@/lib/services/metaAuthService";
import { prisma } from "@/lib/prisma";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";
import type { MetaAdIds } from "@/types/mediaBuyingLayer";

const META_GRAPH_BASE = "https://graph.facebook.com/v20.0";

// ── Tenant Connection Helpers ─────────────────────────────────────────────────

interface TenantMetaIds {
  accessToken: string;
  adAccountId: string;
  pageId: string;
  pixelId: string;
}

/**
 * Fetches the tenant's decrypted access token and stored Meta IDs.
 * Throws if no MetaConnection exists or the token is expired.
 */
async function getTenantMetaIds(tenantId: string): Promise<TenantMetaIds> {
  const [accessToken, connection] = await Promise.all([
    getMetaAccessToken(tenantId),
    prisma.metaConnection.findUnique({ where: { tenantId } }),
  ]);

  if (!connection) {
    throw new Error(
      `No Meta connection found for tenant ${tenantId}. ` +
      "Complete the Meta OAuth flow before running campaigns."
    );
  }

  return {
    accessToken,
    adAccountId: connection.adAccountId,
    pageId: connection.pageId,
    pixelId: connection.pixelId,
  };
}

// ── HTTP Helpers ──────────────────────────────────────────────────────────────

async function metaPost<T>(
  path: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<T> {
  const url = `${META_GRAPH_BASE}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    id?: string;
    error?: { message: string; code: number };
  };

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta API error on POST ${path}: ${msg}`);
  }

  return data as T;
}

async function metaGet<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: accessToken }).toString();
  const url = `${META_GRAPH_BASE}${path}?${qs}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await res.json()) as { error?: { message: string } };

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta API error on GET ${path}: ${msg}`);
  }

  return data as T;
}

async function metaPostStatus<T>(
  path: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<T> {
  const url = `${META_GRAPH_BASE}${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    success?: boolean;
    error?: { message: string };
  };

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta API status update error on ${path}: ${msg}`);
  }

  return data as T;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Creates a Meta Ads campaign for the given blueprint. Returns the Meta campaign ID. */
export async function createCampaign(
  blueprint: CampaignBlueprint,
  tenantId: string
): Promise<string> {
  const { accessToken, adAccountId } = await getTenantMetaIds(tenantId);

  const result = await withRetry(
    () =>
      metaPost<{ id: string }>(
        `/${adAccountId}/campaigns`,
        {
          name: `Aurum | ${blueprint.serviceIntent} | ${blueprint.blueprintId}`,
          objective: blueprint.mediaBuyingLayer.objective ?? "OUTCOME_LEADS",
          status: "PAUSED",
          special_ad_categories: [],
          buying_type: "AUCTION",
        },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.createCampaign" }
  );

  return result.id;
}

/** Creates a Meta Ad Set linked to the given campaign. Returns the ad set ID. */
export async function createAdSet(
  blueprint: CampaignBlueprint,
  campaignId: string,
  tenantId: string
): Promise<string> {
  const { accessToken, adAccountId } = await getTenantMetaIds(tenantId);
  const targeting = blueprint.mediaBuyingLayer.targeting;

  const result = await withRetry(
    () =>
      metaPost<{ id: string }>(
        `/${adAccountId}/adsets`,
        {
          name: `Aurum AdSet | ${blueprint.serviceIntent} | ${blueprint.blueprintId}`,
          campaign_id: campaignId,
          billing_event: "IMPRESSIONS",
          optimization_goal: "LEAD_GENERATION",
          bid_strategy:
            blueprint.mediaBuyingLayer.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
          daily_budget: Math.round(blueprint.budget.dailyUsd * 100),
          targeting: {
            age_min: targeting.ageMin ?? 25,
            age_max: targeting.ageMax ?? 65,
            geo_locations: {
              cities:
                targeting.geoLocations.cities?.map((city: string) => ({
                  key: city,
                })) ?? [],
              countries: targeting.geoLocations.countries ?? ["GB"],
            },
            interests:
              targeting.interests?.map((id: string) => ({ id })) ?? [],
            publisher_platforms:
              blueprint.mediaBuyingLayer.placements.length > 0
                ? blueprint.mediaBuyingLayer.placements
                : ["facebook", "instagram"],
          },
          status: "PAUSED",
          start_time: new Date(Date.now() + 60_000).toISOString(),
        },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.createAdSet" }
  );

  return result.id;
}

/** Uploads a creative asset to Meta and returns the ad creative ID. */
export async function createAdCreative(
  blueprint: CampaignBlueprint,
  tenantId: string
): Promise<string> {
  const { accessToken, adAccountId, pageId, pixelId } =
    await getTenantMetaIds(tenantId);

  const primaryAsset = blueprint.creativeLayer.assets.find(
    (a) => a.assetId === blueprint.creativeLayer.primaryAssetId
  );

  if (!primaryAsset) {
    throw new Error(
      `metaAdsService.createAdCreative: No primary asset found for blueprintId ${blueprint.blueprintId}`
    );
  }

  const landingPageUrl = blueprint.mediaBuyingLayer.landingPageUrl;
  if (!landingPageUrl) {
    throw new Error(
      `metaAdsService.createAdCreative: landingPageUrl is not set on mediaBuyingLayer for blueprintId ${blueprint.blueprintId}`
    );
  }

  const utmParams = blueprint.mediaBuyingLayer.utmParams ?? {};
  const utmString = Object.entries(utmParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const finalUrl = utmString ? `${landingPageUrl}?${utmString}` : landingPageUrl;

  const result = await withRetry(
    () =>
      metaPost<{ id: string }>(
        `/${adAccountId}/adcreatives`,
        {
          name: `Aurum Creative | ${blueprint.serviceIntent} | ${blueprint.blueprintId}`,
          object_story_spec: {
            page_id: pageId,
            video_data: {
              video_id: primaryAsset.assetId,
              message:
                blueprint.creativeLayer.copyVariants?.[0]?.headline ?? "",
              call_to_action: {
                type: "LEARN_MORE",
                value: { link: finalUrl },
              },
            },
          },
          degrees_of_freedom_spec: {
            creative_features_spec: {
              standard_enhancements: { enroll_status: "OPT_OUT" },
            },
          },
          // Use tenant's pixel if available
          ...(pixelId
            ? {
                tracking_specs: [
                  {
                    action_type: ["offsite_conversion"],
                    fb_pixel: [pixelId],
                  },
                ],
              }
            : {}),
        },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.createAdCreative" }
  );

  return result.id;
}

/** Creates a Meta Ad linking the ad set and creative. Returns the ad ID. */
export async function createAd(
  blueprint: CampaignBlueprint,
  adSetId: string,
  creativeId: string,
  tenantId: string
): Promise<string> {
  const { accessToken, adAccountId, pixelId } = await getTenantMetaIds(tenantId);

  const result = await withRetry(
    () =>
      metaPost<{ id: string }>(
        `/${adAccountId}/ads`,
        {
          name: `Aurum Ad | ${blueprint.serviceIntent} | ${blueprint.blueprintId}`,
          adset_id: adSetId,
          creative: { creative_id: creativeId },
          status: "PAUSED",
          tracking_specs: pixelId
            ? [{ action_type: ["offsite_conversion"], fb_pixel: [pixelId] }]
            : [],
        },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.createAd" }
  );

  return result.id;
}

/** Pauses an active Meta campaign. */
export async function pauseCampaign(
  campaignId: string,
  tenantId: string
): Promise<void> {
  const { accessToken } = await getTenantMetaIds(tenantId);
  await withRetry(
    () =>
      metaPostStatus<{ success: boolean }>(
        `/${campaignId}`,
        { status: "PAUSED" },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.pauseCampaign" }
  );
}

/** Resumes a paused Meta campaign. */
export async function resumeCampaign(
  campaignId: string,
  tenantId: string
): Promise<void> {
  const { accessToken } = await getTenantMetaIds(tenantId);
  await withRetry(
    () =>
      metaPostStatus<{ success: boolean }>(
        `/${campaignId}`,
        { status: "ACTIVE" },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.resumeCampaign" }
  );
}

/** Fetches campaign insights for the given date range. */
export async function getCampaignInsights(
  campaignId: string,
  dateRange: { since: string; until: string },
  tenantId: string
): Promise<Record<string, unknown>> {
  const { accessToken } = await getTenantMetaIds(tenantId);
  return withRetry(
    () =>
      metaGet<Record<string, unknown>>(
        `/${campaignId}/insights`,
        {
          fields:
            "impressions,clicks,spend,cpm,cpc,ctr,actions,cost_per_action_type",
          time_range: JSON.stringify(dateRange),
          level: "campaign",
        },
        accessToken
      ),
    { maxAttempts: 3, baseDelayMs: 500, label: "metaAdsService.getCampaignInsights" }
  );
}

// ── Typed spend summary wrapper (Sprint 8) ──────────────────────────────────────
// getCampaignInsights returns the raw Meta response. This wrapper computes a
// preset date range, unwraps `data[0]`, converts USD→GBP, and extracts lead
// count from the `actions` array — returning a typed, UI-ready summary.

const META_USD_TO_GBP = 0.787;

export interface CampaignSpendSummary {
  spendGbp: number;
  leads:    number;
  cplGbp:   number | null;
}

function insightsRow(raw: Record<string, unknown>): Record<string, unknown> {
  const data = raw.data;
  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }
  return raw;
}

function extractLeads(row: Record<string, unknown>): number {
  const actions = row.actions;
  if (!Array.isArray(actions)) return 0;
  let leads = 0;
  for (const a of actions) {
    if (a && typeof a === "object") {
      const { action_type, value } = a as { action_type?: string; value?: string };
      if (action_type === "lead" || action_type === "onsite_conversion.lead_grouped") {
        leads += Number.parseFloat(value ?? "0") || 0;
      }
    }
  }
  return leads;
}

export async function getCampaignSpendSummary(
  tenantId: string,
  campaignId: string,
  preset: "today" | "last_7d"
): Promise<CampaignSpendSummary> {
  const now = new Date();
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  const dateRange =
    preset === "today"
      ? { since: fmt(now), until: fmt(now) }
      : { since: fmt(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)), until: fmt(now) };

  const row      = insightsRow(await getCampaignInsights(campaignId, dateRange, tenantId));
  const spendUsd = Number.parseFloat((row.spend as string) ?? "0") || 0;
  const spendGbp = Math.round(spendUsd * META_USD_TO_GBP * 100) / 100;
  const leads    = extractLeads(row);
  const cplGbp   = leads > 0 ? Math.round((spendGbp / leads) * 100) / 100 : null;

  return { spendGbp, leads, cplGbp };
}

/** Activates all components of a campaign (campaign + adset + ad). */
export async function activateCampaign(
  metaAdIds: MetaAdIds,
  tenantId: string
): Promise<void> {
  const { accessToken } = await getTenantMetaIds(tenantId);
  await withRetry(
    () =>
      metaPostStatus<{ success: boolean }>(
        `/${metaAdIds.campaignId}`,
        { status: "ACTIVE" },
        accessToken
      ),
    {
      maxAttempts: 3,
      baseDelayMs: 500,
      label: "metaAdsService.activateCampaign.campaign",
    }
  );
  await withRetry(
    () =>
      metaPostStatus<{ success: boolean }>(
        `/${metaAdIds.adSetId}`,
        { status: "ACTIVE" },
        accessToken
      ),
    {
      maxAttempts: 3,
      baseDelayMs: 500,
      label: "metaAdsService.activateCampaign.adSet",
    }
  );
  await withRetry(
    () =>
      metaPostStatus<{ success: boolean }>(
        `/${metaAdIds.adId}`,
        { status: "ACTIVE" },
        accessToken
      ),
    {
      maxAttempts: 3,
      baseDelayMs: 500,
      label: "metaAdsService.activateCampaign.ad",
    }
  );
}

/**
 * Updates the daily budget on a Meta ad set.
 *
 * @param adSetId          - Meta ad set ID (e.g. "23843...")
 * @param dailyBudgetCents - Daily budget in USD cents (Meta expects an integer string)
 * @param tenantId         - Clerk org ID used to retrieve the encrypted access token
 */
export async function updateCampaignBudget(
  adSetId: string,
  dailyBudgetCents: number,
  tenantId: string
): Promise<void> {
  const { accessToken } = await getTenantMetaIds(tenantId);

  await withRetry(
    () =>
      metaPostStatus<{ success: boolean }>(
        `/${adSetId}`,
        // Meta Graph API expects daily_budget as a string of integer cents
        { daily_budget: Math.round(dailyBudgetCents).toString() },
        accessToken
      ),
    {
      maxAttempts: 3,
      baseDelayMs: 500,
      label: "metaAdsService.updateCampaignBudget",
    }
  );
}
