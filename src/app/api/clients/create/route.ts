/**
 * POST /api/clients/create
 *
 * Creates a CampaignBlueprint + AIRepresentative from the Add Client wizard.
 * No orchestration — that happens later. Status is set to "pending".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getSubscriptionStatus, isPlatformActive } from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

const GBP_TO_USD = 1.27;

interface CreateBody {
  businessName:        string;
  websiteUrl?:         string;
  offer?:              string;
  targetLocation?:     string;
  vertical:            string;
  agentName:           string;
  voiceId:             string;
  dailyBudgetGbp:      number;
  metaAdAccountId?:    string;
  isExistingCampaign:  boolean;
  existingCampaignIds?: string[];
  websiteScrape?:      Record<string, unknown>;
  clientTier?:         string;
  clientContactName?:  string;
  clientWhatsApp?:     string;
}

const VALID_TIERS = new Set(["starter", "full_service"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId     = orgId ?? `pending:${userId}`;
  const pendingOrgLink = !orgId;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.businessName?.trim()) {
    return NextResponse.json({ error: "businessName is required" }, { status: 400 });
  }
  if (!body.agentName?.trim()) {
    return NextResponse.json({ error: "agentName is required" }, { status: 400 });
  }

  // Gate: once the 14-day trial ends (past_due / canceled / expired trial), a
  // live payment method is required before deploying further clients. Tenants
  // with no subscription row yet are in onboarding grace and allowed through.
  const subscription = await getSubscriptionStatus(tenantId);
  if (!isPlatformActive(subscription)) {
    return NextResponse.json(
      { error: "Please add a payment method to continue." },
      { status: 402 }
    );
  }

  const dailyBudgetUsd = (body.dailyBudgetGbp ?? 50) * GBP_TO_USD;

  const mediaBuying: Record<string, unknown> = {};
  if (body.metaAdAccountId) mediaBuying.adAccountId = body.metaAdAccountId;
  if (body.isExistingCampaign && body.existingCampaignIds?.length) {
    mediaBuying.existingCampaignIds = body.existingCampaignIds;
  }

  const deployment: Record<string, unknown> = {};
  if (body.websiteUrl) deployment.websiteUrl = body.websiteUrl;
  if (body.websiteScrape) deployment.websiteScrape = body.websiteScrape;

  const clientTier = body.clientTier && VALID_TIERS.has(body.clientTier)
    ? body.clientTier
    : "full_service";

  // Atomic: a blueprint without its representative is a broken client, so
  // create both in one transaction — either both land or neither does.
  const { blueprint, rep } = await prisma.$transaction(async (tx) => {
    const blueprint = await tx.campaignBlueprint.create({
      data: {
        tenantId,
        pendingOrgLink,
        status:         "pending",
        clientTier,
        vertical:       body.vertical || "other",
        businessName:   body.businessName.trim(),
        targetLocation: body.targetLocation?.trim() || "UK",
        dailyBudgetUsd,
        clientContactName: body.clientContactName?.trim() || null,
        clientWhatsApp:    body.clientWhatsApp?.trim() || null,
        creative:       {},
        mediaBuying: mediaBuying as Prisma.InputJsonValue,
        deployment:  deployment  as Prisma.InputJsonValue,
        voice:          {},
        crm:            {},
        offerHook:      body.offer?.trim() ?? null,
        businessDescription: body.websiteScrape
          ? (body.websiteScrape.description as string | undefined ?? body.offer?.trim() ?? null)
          : (body.offer?.trim() ?? null),
      },
    });

    const rep = await tx.aIRepresentative.create({
      data: {
        blueprintId: blueprint.id,
        tenantId,
        repName:     body.agentName.trim(),
        voiceId:     body.voiceId || "female-british",
      },
    });

    // Seed the ClientBrief from the website scrape so the agent starts with
    // real knowledge on day one. The owner refines it later in the brief editor.
    const scrape = body.websiteScrape ?? null;
    const sellingPoints = scrape && Array.isArray(scrape.sellingPoints)
      ? (scrape.sellingPoints as unknown[]).filter((s): s is string => typeof s === "string")
      : [];
    await tx.clientBrief.create({
      data: {
        blueprintId:          blueprint.id,
        tenantId,
        websiteSummary:       (scrape?.description as string | undefined)?.trim() || null,
        idealCustomerProfile: (scrape?.targetCustomer as string | undefined)?.trim() || null,
        brandTone:            (scrape?.tone as string | undefined)?.trim() || null,
        keyUSPs:              sellingPoints.length ? sellingPoints.join("; ") : null,
        clientContactName:    body.clientContactName?.trim() || null,
        clientWhatsApp:       body.clientWhatsApp?.trim() || null,
      },
    });

    return { blueprint, rep };
  });

  return NextResponse.json({ blueprintId: blueprint.id, agentName: rep.repName });
}
