// src/app/api/representative/route.ts
// GET  /api/representative?blueprintId=<id>
// PATCH /api/representative
//
// GET  — returns the AIRepresentative for a blueprint (or null if not configured).
//         Never returns 402 — viewing config is always allowed.
// PATCH — upserts the AIRepresentative, assembles + deploys the prompt.
//         Returns 402 if no active subscription.
//         If Retell deploy fails: logs to CommandLog but still returns the saved record.

import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { prisma }                     from "@/lib/prisma";
import { validateStripeMandate }      from "@/lib/services/stripeService";
import { assembleRetellPromptAsync }  from "@/lib/services/retellPromptAssembler";
import { updateRetellAgent }          from "@/lib/services/retellService";
import { RepresentativePersonality }  from "@prisma/client";
import type { VoiceLayer }            from "@/types/voiceLayer";
import type { CRMLayer }              from "@/types/crmLayer";
import type { CreativeLayer }         from "@/types/creativeLayer";
import type { MediaBuyingLayer }      from "@/types/mediaBuyingLayer";
import type { DeploymentLayer }       from "@/types/deploymentLayer";
import type { CampaignBlueprint, OrchestratorEvent } from "@/types/campaignBlueprint";
import { ServiceVertical, CampaignStatus } from "@/enums/campaignEnums";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

// ── PATCH body schema ─────────────────────────────────────────────────────────

const PatchBodySchema = z.object({
  blueprintId:              z.string().min(1),
  repName:                  z.string().min(1).max(80).optional(),
  personality:              z.nativeEnum(RepresentativePersonality).optional(),
  customIntroLine:          z.string().max(500).nullable().optional(),
  customObjectionResponses: z.record(z.string(), z.string()).optional(),
  voiceId:                  z.string().max(200).nullable().optional(),
});

// ── Helper: build CampaignBlueprint from Prisma row ──────────────────────────

function buildBlueprintFromRow(row: {
  id:            string;
  tenantId:      string;
  status:        string;
  vertical:      string;
  businessName:  string;
  targetLocation:string;
  dailyBudgetUsd:number;
  creative:      unknown;
  mediaBuying:   unknown;
  deployment:    unknown;
  voice:         unknown;
  crm:           unknown;
  orchestrationLog: unknown;
  createdAt:     Date;
  updatedAt:     Date;
}): CampaignBlueprint & { businessName: string; targetLocation: string } {
  return {
    blueprintId:      row.id,
    tenantId:         row.tenantId,
    serviceIntent:    row.vertical as ServiceVertical,
    status:           row.status as CampaignStatus,
    businessName:     row.businessName,
    targetLocation:   row.targetLocation,
    budget: {
      dailyUsd:          row.dailyBudgetUsd,
      monthlyCapUsd:     row.dailyBudgetUsd * 30.5,
      stripeMandateId:   "",
      billingCycleStart: row.createdAt.toISOString().split("T")[0]!,
    },
    creativeLayer:    row.creative    as unknown as CreativeLayer,
    mediaBuyingLayer: row.mediaBuying as unknown as MediaBuyingLayer,
    deploymentLayer:  row.deployment  as unknown as DeploymentLayer,
    voiceLayer:       row.voice       as unknown as VoiceLayer,
    crmLayer:         row.crm         as unknown as CRMLayer,
    orchestrationLog: (row.orchestrationLog as unknown as OrchestratorEvent[]) ?? [],
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
  };
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId;

  const blueprintId = req.nextUrl.searchParams.get("blueprintId");
  if (!blueprintId) {
    return NextResponse.json({ error: "blueprintId query param is required" }, { status: 400 });
  }

  // Verify blueprint belongs to tenant
  const blueprint = await prisma.campaignBlueprint.findFirst({
    where: { id: blueprintId, tenantId },
    select: { id: true },
  });
  if (!blueprint) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const representative = await prisma.aIRepresentative.findUnique({
    where: { blueprintId },
  });

  return NextResponse.json(representative ?? null, { status: 200 });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest): Promise<NextResponse> {
const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId;

  // Subscription guard
  const hasMandate = await validateStripeMandate(tenantId);
  if (!hasMandate) {
    return NextResponse.json({ error: "No active subscription" }, { status: 402 });
  }

  // Parse body
  let body: z.infer<typeof PatchBodySchema>;
  try {
    const raw = await req.json() as unknown;
    body = PatchBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { blueprintId, repName, personality, customIntroLine, customObjectionResponses, voiceId } = body;

  // Verify blueprint belongs to tenant
  const blueprintRow = await prisma.campaignBlueprint.findFirst({
    where: { id: blueprintId, tenantId },
  });
  if (!blueprintRow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Upsert AIRepresentative
  const updatedRep = await prisma.aIRepresentative.upsert({
    where:  { blueprintId },
    create: {
      blueprintId,
      tenantId,
      repName:                  repName                  ?? "Your assistant",
      personality:              personality              ?? RepresentativePersonality.PROFESSIONAL,
      customIntroLine:          customIntroLine          ?? null,
      customObjectionResponses: customObjectionResponses ?? {},
      voiceId:                  voiceId                  ?? null,
    },
    update: {
      ...(repName                  !== undefined && { repName }),
      ...(personality              !== undefined && { personality }),
      ...(customIntroLine          !== undefined && { customIntroLine }),
      ...(customObjectionResponses !== undefined && { customObjectionResponses }),
      ...(voiceId                  !== undefined && { voiceId }),
    },
  });

  // Assemble and deploy prompt
  const blueprint = buildBlueprintFromRow(blueprintRow);
  const assembledPrompt = await assembleRetellPromptAsync(blueprint, updatedRep);

  const agentId = (blueprintRow.voice as unknown as VoiceLayer)?.retellAgentId ?? "";

  if (agentId) {
    try {
      await updateRetellAgent(agentId, assembledPrompt);
      await prisma.aIRepresentative.update({
        where: { blueprintId },
        data:  { lastDeployedAt: new Date() },
      });
    } catch (err) {
      // Log but do NOT fail the PATCH
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[representative PATCH] Deploy failed for ${blueprintId}: ${msg}`);
      await prisma.commandLog.create({
        data: {
          tenantId,
          rawInput:   `PATCH /api/representative blueprintId=${blueprintId}`,
          intentType: "REPRESENTATIVE_DEPLOY_FAILED",
          blueprintId,
          success:    false,
          errorMsg:   msg,
        },
      });
    }
  }

  return NextResponse.json(updatedRep, { status: 200 });
}
