/**
 * scripts/onboard-deploy.ts  (onboard-roofer skill — Step 5)
 *
 * Takes a provisioned DRAFT client live, up to the review gate:
 *   --go-live   → provisions Sophie (Retell agent from the brief, dedicated number,
 *                 status LIVE) so every new lead is called within 60s, and confirms
 *                 the landing-page URL (the in-app /lp/<id> page).
 *   --with-ads  → builds the Meta campaign + ad set (PAUSED) on the CLIENT'S connected
 *                 Meta account, pointed at the landing page, from the stored media plan.
 *                 Ad spend only starts when Lewis un-pauses the campaign — that's the
 *                 review gate. The video creative is the one human review item.
 *
 * Reuses the app's own services (deployCaller/provisionClientAgent, metaAdsService) so
 * everything lands in the DB the app manages. NEVER hard-fails the whole run on one
 * step — reports what worked and what's still needed. Prints a status summary.
 *
 * Run: npm run onboard:deploy -- --blueprint <id> --go-live --with-ads
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { deployCaller } from "../src/lib/agents/roles/caller";
import { createCampaign, createAdSet } from "../src/lib/services/metaAdsService";
import type { CampaignBlueprint } from "../src/types/campaignBlueprint";

const APP = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://aurum-growth-os.vercel.app").replace(/\/$/, "");

function parseArgs(argv: string[]): { opts: Record<string, string>; flags: Set<string> } {
  const opts: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const n = argv[i + 1]; if (n && !n.startsWith("--")) { opts[k] = n; i++; } else flags.add(k); }
  }
  return { opts, flags };
}

interface StoredTargeting { ageMin?: number; ageMax?: number; countries?: string[]; cities?: string[]; placements?: string[] }
interface StoredMediaBuying {
  objective?: string; bidStrategy?: string; landingPageUrl?: string;
  targeting?: StoredTargeting; utmParams?: Record<string, string>; metaAdIds?: Record<string, string>;
}

/** Maps the DB row + stored media plan to the minimal typed blueprint the Meta services read. */
function toTypedBlueprint(row: { id: string; vertical: string; dailyBudgetUsd: number }, mb: StoredMediaBuying): CampaignBlueprint {
  const t = mb.targeting ?? {};
  return {
    blueprintId:   row.id,
    serviceIntent: row.vertical,
    budget:        { dailyUsd: row.dailyBudgetUsd },
    mediaBuyingLayer: {
      objective:      mb.objective ?? "LEAD_GENERATION",
      bidStrategy:    mb.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
      placements:     t.placements ?? ["facebook", "instagram"],
      landingPageUrl: mb.landingPageUrl ?? `${APP}/lp/${row.id}`,
      utmParams:      mb.utmParams ?? {},
      targeting: {
        ageMin:       t.ageMin ?? 35,
        ageMax:       t.ageMax ?? 65,
        // Country-level geo for safety; precise city/radius keys are a Meta-side refinement.
        geoLocations: { cities: [], countries: t.countries ?? ["GB"] },
        interests:    [],
      },
    },
  } as unknown as CampaignBlueprint;
}

async function main(): Promise<void> {
  const { opts, flags } = parseArgs(process.argv.slice(2));
  const blueprintId = opts.blueprint?.trim();
  if (!blueprintId) { console.error("ERROR: --blueprint <id> is required"); process.exit(1); }

  const row = await prisma.campaignBlueprint.findUnique({
    where: { id: blueprintId },
    select: { id: true, tenantId: true, vertical: true, businessName: true, dailyBudgetUsd: true, status: true, mediaBuying: true, voice: true },
  });
  if (!row) { console.error(`ERROR: blueprint ${blueprintId} not found`); process.exit(1); }

  const tenantId = row.tenantId;
  const mb: StoredMediaBuying = (row.mediaBuying && typeof row.mediaBuying === "object" ? row.mediaBuying : {}) as StoredMediaBuying;
  const lpUrl = mb.landingPageUrl ?? `${APP}/lp/${row.id}`;

  const report: Record<string, unknown> = { blueprintId, business: row.businessName, vertical: row.vertical, lpUrl };

  // ── Ensure the funnel URL is the in-app landing page (idempotent) ───────────
  if (mb.landingPageUrl !== lpUrl) {
    await prisma.campaignBlueprint.update({
      where: { id: blueprintId },
      data: { mediaBuying: { ...mb, landingPageUrl: lpUrl } as unknown as Prisma.InputJsonValue },
    }).catch((e) => console.error("[deploy] set landingPageUrl failed:", e instanceof Error ? e.message : e));
  }

  if (!flags.has("go-live") && !flags.has("with-ads")) {
    report.mode = "dry-run";
    report.willDo = ["--go-live → provision Sophie (Retell) + set LIVE", "--with-ads → build Meta campaign + ad set (PAUSED) on the client's account"];
    console.log(JSON.stringify(report, null, 2));
    await prisma.$disconnect();
    return;
  }

  // ── Sophie: provision the Retell agent + flip LIVE (no ad spend) ────────────
  if (flags.has("go-live")) {
    try {
      const res = await deployCaller(blueprintId, tenantId);
      report.sophie = { provisioned: true, agentId: res.agentId, created: res.created, status: "LIVE — new leads called within 60s, booked into the funnel" };
    } catch (err) {
      report.sophie = { provisioned: false, error: err instanceof Error ? err.message : String(err), hint: "Set RETELL_API_KEY (+ Twilio for a dedicated number) and re-run." };
    }
  }

  // ── Meta: build campaign + ad set, PAUSED, on the client's connected account ─
  if (flags.has("with-ads")) {
    const meta = await prisma.metaConnection.findUnique({ where: { tenantId }, select: { adAccountId: true } }).catch(() => null);
    if (!meta) {
      report.metaAds = {
        built: false,
        reason: "No Meta connection for this client. Connecting a client's Meta account is a one-time OAuth — do it in the app (Settings → Connect Meta), then re-run with --with-ads.",
      };
    } else {
      try {
        const typed = toTypedBlueprint(row, mb);
        const campaignId = await createCampaign(typed, tenantId);
        const adSetId = await createAdSet(typed, campaignId, tenantId);
        await prisma.campaignBlueprint.update({
          where: { id: blueprintId },
          data: { mediaBuying: { ...mb, landingPageUrl: lpUrl, metaAdIds: { campaignId, adSetId } } as unknown as Prisma.InputJsonValue },
        });
        report.metaAds = {
          built: true, status: "PAUSED", campaignId, adSetId,
          remaining: "Attach the approved video creative (createAdCreative + createAd), then UN-PAUSE the campaign in the app/Meta to start spend. Marcus then manages it from there.",
        };
      } catch (err) {
        report.metaAds = { built: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  report.nextForLewis = [
    "Review the landing page at the lpUrl.",
    "If Meta wasn't connected: connect the client's Meta in the app, then re-run with --with-ads.",
    "Approve the video creative, attach it, and un-pause the campaign to go live.",
    "Then just check the app once a day — Marcus manages the ads, Sophie calls the leads.",
  ];
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("onboard:deploy FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
