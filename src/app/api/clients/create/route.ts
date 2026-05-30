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
}

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

  const dailyBudgetUsd = (body.dailyBudgetGbp ?? 50) * GBP_TO_USD;

  const mediaBuying: Record<string, unknown> = {};
  if (body.metaAdAccountId) mediaBuying.adAccountId = body.metaAdAccountId;
  if (body.isExistingCampaign && body.existingCampaignIds?.length) {
    mediaBuying.existingCampaignIds = body.existingCampaignIds;
  }

  const deployment: Record<string, unknown> = {};
  if (body.websiteUrl) deployment.websiteUrl = body.websiteUrl;
  if (body.websiteScrape) deployment.websiteScrape = body.websiteScrape;

  const blueprint = await prisma.campaignBlueprint.create({
    data: {
      tenantId,
      pendingOrgLink,
      status:         "pending",
      vertical:       body.vertical || "other",
      businessName:   body.businessName.trim(),
      targetLocation: body.targetLocation?.trim() || "UK",
      dailyBudgetUsd,
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

  const rep = await prisma.aIRepresentative.create({
    data: {
      blueprintId: blueprint.id,
      tenantId,
      repName:     body.agentName.trim(),
      voiceId:     body.voiceId || "female-british",
    },
  });

  return NextResponse.json({ blueprintId: blueprint.id, agentName: rep.repName });
}
