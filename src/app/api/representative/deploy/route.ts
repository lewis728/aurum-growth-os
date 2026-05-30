// src/app/api/representative/deploy/route.ts
// POST /api/representative/deploy
//
// Re-deploys the assembled prompt for an existing AIRepresentative to the
// voice agent platform. Useful after vertical profile updates or manual
// re-deployments from the dashboard.

import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { prisma }                     from "@/lib/prisma";
import { validateStripeMandate }      from "@/lib/services/stripeService";
import { assembleRetellPromptAsync }  from "@/lib/services/retellPromptAssembler";
import { updateRetellAgent }          from "@/lib/services/retellService";
import type { VoiceLayer }            from "@/types/voiceLayer";
import type { CRMLayer }              from "@/types/crmLayer";
import type { CreativeLayer }         from "@/types/creativeLayer";
import type { MediaBuyingLayer }      from "@/types/mediaBuyingLayer";
import type { DeploymentLayer }       from "@/types/deploymentLayer";
import type { CampaignBlueprint, OrchestratorEvent } from "@/types/campaignBlueprint";
import { ServiceVertical, CampaignStatus } from "@/enums/campaignEnums";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  blueprintId: z.string().min(1),
});

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // ── Subscription guard ──────────────────────────────────────────────────────
  const hasMandate = await validateStripeMandate(tenantId);
  if (!hasMandate) {
    return NextResponse.json({ error: "No active subscription" }, { status: 402 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json() as unknown;
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { blueprintId } = body;

  // ── Fetch AIRepresentative ──────────────────────────────────────────────────
  const representative = await prisma.aIRepresentative.findUnique({
    where: { blueprintId },
  });
  if (!representative) {
    return NextResponse.json({ error: "No representative configured for this campaign" }, { status: 404 });
  }
  if (representative.tenantId !== tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Fetch CampaignBlueprint ─────────────────────────────────────────────────
  const blueprintRow = await prisma.campaignBlueprint.findFirst({
    where: { id: blueprintId, tenantId },
  });
  if (!blueprintRow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Assemble and deploy ─────────────────────────────────────────────────────
  const blueprint = buildBlueprintFromRow(blueprintRow);
  const assembledPrompt = await assembleRetellPromptAsync(blueprint, representative);

  const agentId = (blueprintRow.voice as unknown as VoiceLayer)?.retellAgentId ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "No voice agent configured for this campaign" }, { status: 422 });
  }

  await updateRetellAgent(agentId, assembledPrompt);

  const deployedAt = new Date();
  await prisma.aIRepresentative.update({
    where: { blueprintId },
    data:  { lastDeployedAt: deployedAt },
  });

  return NextResponse.json({ deployed: true, deployedAt }, { status: 200 });
}
