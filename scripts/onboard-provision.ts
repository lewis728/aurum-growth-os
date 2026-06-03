/**
 * scripts/onboard-provision.ts  (onboard-roofer skill — Step 4)
 *
 * Creates the DRAFT client in the SAME tables the app reads: CampaignBlueprint
 * (status "pending") + AIRepresentative + a FULL ClientBrief (maximum information
 * for Marcus the media buyer + Sophie the caller), plus the media plan/targeting on
 * the blueprint's mediaBuying layer. Sets the landing-page URL to the in-app
 * /lp/<id> page (which is live the moment the blueprint exists).
 *
 * Niches: roofing | home_improvement. Worldwide-ready (country drives region).
 * Nothing is deployed/spent here — that's onboard:deploy. Prints { blueprintId, lpUrl }.
 *
 * Run: npm run onboard:provision -- --brief ./tmp/<client>.json
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { defaultTemplatesForVertical } from "../src/lib/services/smsTemplates";
import { normaliseNiche } from "../src/lib/outreach/niche";
import { detectCountry } from "../src/lib/outreach/regional";

const GBP_TO_USD = 1.27;
// Prefer ONBOARD_APP_URL for onboarding so the saved landing/ad URL is the PROD app,
// not a dev NEXT_PUBLIC_APP_URL=localhost (which would break the Meta ad link).
const APP = (process.env.ONBOARD_APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://aurum-growth-os.vercel.app").replace(/\/$/, "");

interface ObjectionPair { objection: string; response: string }

interface OnboardBrief {
  websiteSummary?:        string;
  idealCustomerProfile?:  string;
  qualificationQuestions?: string;
  keyUSPs?:               string;
  objectionResponses?:    ObjectionPair[];
  complianceNotes?:       string;
  brandTone?:             string;
  badLeadSignals?:        string;
  competitorNames?:       string;
  averageClientValue?:    number;
  targetCplGbp?:          number;
  budgetHardLimitGbp?:    number;
  approvalThresholdGbp?:  number;
  mediaPlan?:             string;  // plain-English plan for the record + Marcus
  adCopy?:                string;  // the ad copy variants Lewis approved
  // ── Deep onboarding research (read by Marcus via clientContext) ──────────────
  winningStrategy?:       string;  // proven angle/offer/creative/funnel for this business+area
  mediaBuyerPlaybook?:    string;  // exact optimisation manual: bands + scale/pause/refresh rules
  localCplBenchmark?:     number;  // local CPL to optimise toward
  competitorSnapshot?:    Record<string, unknown>;  // { count, notable[] } from the research
  geoIntelligence?:       Record<string, unknown>;  // city-specific market intel
}

interface OnboardTargeting {
  ageMin?:     number;
  ageMax?:     number;
  radiusKm?:   number;
  cities?:     string[];
  placements?: string[];
}

interface OnboardInput {
  businessName:       string;
  websiteUrl?:        string;
  targetLocation?:    string;  // city / service area
  country?:           string;  // ISO-ish; default GB
  niche?:             string;  // roofing | home_improvement
  dailyBudgetGbp?:    number;
  agentName?:         string;
  voiceId?:           string;
  offerHook?:         string;  // → landing-page headline
  clientContactName?: string;
  clientWhatsApp?:    string;
  websiteScrape?:     Record<string, unknown>;
  brief?:             OnboardBrief;
  targeting?:         OnboardTargeting;
}

function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const n = argv[i + 1]; if (n && !n.startsWith("--")) { opts[k] = n; i++; } }
  }
  return opts;
}

async function resolveTenant(argTenant?: string): Promise<string> {
  if (argTenant) return argTenant;
  if (process.env.ONBOARD_TENANT) return process.env.ONBOARD_TENANT;
  if (process.env.OUTREACH_DEFAULT_TENANT) return process.env.OUTREACH_DEFAULT_TENANT;
  const bp = await prisma.campaignBlueprint.findFirst({ orderBy: { createdAt: "desc" }, select: { tenantId: true } }).catch(() => null);
  if (bp?.tenantId) return bp.tenantId;
  throw new Error("No tenant resolved — pass --tenant <id> or set ONBOARD_TENANT / OUTREACH_DEFAULT_TENANT.");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.brief) { console.error("ERROR: --brief <path-to-json> is required"); process.exit(1); }

  const raw = fs.readFileSync(path.resolve(process.cwd(), opts.brief), "utf8");
  const input = JSON.parse(raw) as OnboardInput;
  if (!input.businessName?.trim()) { console.error("ERROR: businessName is required in the brief JSON"); process.exit(1); }

  const tenantId = await resolveTenant(opts.tenant);
  const vertical = normaliseNiche(input.niche ?? "roofing"); // roofing | home_improvement
  const country = (input.country ?? detectCountry(input.targetLocation)).toUpperCase();
  const dailyBudgetGbp = input.dailyBudgetGbp ?? 50;
  const dailyBudgetUsd = Math.round(dailyBudgetGbp * GBP_TO_USD * 100) / 100;
  const b = input.brief ?? {};
  const t = input.targeting ?? {};

  // Media plan + targeting → mediaBuying layer (Marcus reads this; deploy builds the
  // Meta campaign from it). landingPageUrl is filled after we know the blueprint id.
  const mediaBuying: Record<string, unknown> = {
    objective:    "LEAD_GENERATION",
    bidStrategy:  "LOWEST_COST_WITHOUT_CAP",
    dailyBudgetUsd,
    targeting: {
      ageMin:     t.ageMin ?? 35,
      ageMax:     t.ageMax ?? 65,
      radiusKm:   t.radiusKm ?? 25,
      countries:  [country],
      cities:     t.cities ?? (input.targetLocation ? [input.targetLocation] : []),
      placements: t.placements ?? ["facebook", "instagram"],
    },
    mediaPlan: b.mediaPlan ?? null,
    adCopy:    b.adCopy ?? null,
    utmParams: { source: "meta", medium: "paid_social", campaign: "", content: "" },
  };

  const deployment: Record<string, unknown> = {};
  if (input.websiteUrl) deployment.websiteUrl = input.websiteUrl;
  if (input.websiteScrape) deployment.websiteScrape = input.websiteScrape;

  const objectionJson = Array.isArray(b.objectionResponses) ? b.objectionResponses : [];

  const { blueprintId, repName } = await prisma.$transaction(async (tx) => {
    const blueprint = await tx.campaignBlueprint.create({
      data: {
        tenantId,
        status:         "pending",
        clientTier:     "full_service",
        vertical,
        businessName:   input.businessName.trim(),
        targetLocation: input.targetLocation?.trim() || "UK",
        dailyBudgetUsd,
        clientContactName: input.clientContactName?.trim() || null,
        clientWhatsApp:    input.clientWhatsApp?.trim() || null,
        creative:    {} as Prisma.InputJsonValue,
        mediaBuying: mediaBuying as Prisma.InputJsonValue,
        deployment:  deployment as Prisma.InputJsonValue,
        voice:       {} as Prisma.InputJsonValue,
        crm:         {} as Prisma.InputJsonValue,
        offerHook:   input.offerHook?.trim() ?? null,
        businessDescription: b.websiteSummary?.trim() ?? input.offerHook?.trim() ?? null,
      },
    });

    // Now we know the id → set the in-app landing page as the funnel URL.
    const lpUrl = `${APP}/lp/${blueprint.id}`;
    await tx.campaignBlueprint.update({
      where: { id: blueprint.id },
      data:  { mediaBuying: { ...mediaBuying, landingPageUrl: lpUrl } as Prisma.InputJsonValue },
    });

    await tx.aIRepresentative.create({
      data: { blueprintId: blueprint.id, tenantId, repName: input.agentName?.trim() || "Sophie", voiceId: input.voiceId?.trim() || "female-british" },
    });

    // FULL brief — maximum information for Marcus (guardrails/benchmark) + Sophie.
    await tx.clientBrief.create({
      data: {
        blueprintId:            blueprint.id,
        tenantId,
        websiteSummary:         b.websiteSummary?.trim() || null,
        idealCustomerProfile:   b.idealCustomerProfile?.trim() || null,
        qualificationQuestions: b.qualificationQuestions?.trim() || null,
        keyUSPs:                b.keyUSPs?.trim() || null,
        objectionResponses:     objectionJson as unknown as Prisma.InputJsonValue,
        complianceNotes:        b.complianceNotes?.trim() || null,
        winningStrategy:        b.winningStrategy?.trim() || null,
        mediaBuyerPlaybook:     b.mediaBuyerPlaybook?.trim() || null,
        localCplBenchmark:      typeof b.localCplBenchmark === "number" ? b.localCplBenchmark : null,
        competitorSnapshot:     b.competitorSnapshot ? (b.competitorSnapshot as Prisma.InputJsonValue) : undefined,
        geoIntelligence:        b.geoIntelligence ? (b.geoIntelligence as Prisma.InputJsonValue) : undefined,
        brandTone:              b.brandTone?.trim() || null,
        badLeadSignals:         b.badLeadSignals?.trim() || null,
        competitorNames:        b.competitorNames?.trim() || null,
        averageClientValue:     typeof b.averageClientValue === "number" ? b.averageClientValue : null,
        targetCplGbp:           typeof b.targetCplGbp === "number" ? b.targetCplGbp : null,
        budgetHardLimit:        typeof b.budgetHardLimitGbp === "number" ? b.budgetHardLimitGbp : Math.round(dailyBudgetGbp * 2),
        approvalThreshold:      typeof b.approvalThresholdGbp === "number" ? b.approvalThresholdGbp : Math.round(dailyBudgetGbp * 0.5),
        clientContactName:      input.clientContactName?.trim() || null,
        clientWhatsApp:         input.clientWhatsApp?.trim() || null,
        smsTemplates:           defaultTemplatesForVertical(vertical) as unknown as Prisma.InputJsonValue,
      },
    });

    return { blueprintId: blueprint.id, repName: input.agentName?.trim() || "Sophie" };
  });

  const lpUrl = `${APP}/lp/${blueprintId}`;
  console.log(JSON.stringify({
    ok: true, blueprintId, repName, vertical, country, dailyBudgetGbp, lpUrl,
    status: "pending (draft) — review the landing page, then: npm run onboard:deploy -- --blueprint " + blueprintId + " --go-live",
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("onboard:provision FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
