/**
 * src/lib/services/agentProvisioning.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * The real "Deploy Sophie" moment: provisions a dedicated Retell voice agent for
 * a single client (blueprint), from that client's brief.
 *
 * Idempotent  — if the blueprint already has an agent, the prompt is updated in
 *               place (no duplicate agent, no double spend).
 * Brief-aware — the ClientBrief is appended to the assembled system prompt so the
 *               agent qualifies, handles objections, and respects compliance for
 *               THIS client specifically.
 * Fail-safe   — external calls go through withRetry inside retellService; a hard
 *               failure throws so the caller (deploy route) can surface it.
 *
 * On success the agent id is written to BOTH places that matter:
 *   1. AIRepresentative.retellAgentId / retellLlmId  (canonical record)
 *   2. CampaignBlueprint.voice.retellAgentId         (what speedToLeadService reads)
 * and the blueprint is set LIVE so new leads are called within 60 seconds.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createRetellLlm,
  createRetellAgent,
  updateRetellLlmPrompt,
} from "@/lib/services/retellService";
import { assembleRetellPromptAsync } from "@/lib/services/retellPromptAssembler";
import { renderBriefBlock } from "@/lib/agents/clientContext";
import { CampaignStatus } from "@/enums/campaignEnums";

export interface ProvisionResult {
  agentId: string;
  llmId:   string;
  created: boolean; // true = new agent created, false = existing agent updated in place
}

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    "https://aurum-growth-os.vercel.app";
  return raw.replace(/\/$/, "");
}

/**
 * Builds the minimal object shape the prompt assembler reads. The assembler is
 * wrapped in its own try/catch and falls back gracefully if JSON layers are empty
 * (as they are for a freshly-created client), so a partial object is safe here.
 */
function buildBlueprintForAssembler(row: {
  id:             string;
  vertical:       string;
  businessName:   string;
  targetLocation: string;
  voice:          unknown;
  crm:            unknown;
}): Parameters<typeof assembleRetellPromptAsync>[0] {
  return {
    blueprintId:    row.id,
    serviceIntent:  row.vertical,
    businessName:   row.businessName,
    targetLocation: row.targetLocation,
    voiceLayer:     (row.voice ?? {}),
    crmLayer:       (row.crm ?? {}),
  } as unknown as Parameters<typeof assembleRetellPromptAsync>[0];
}

async function persistAgentToBlueprint(
  blueprintId: string,
  currentVoice: unknown,
  agentId: string,
  llmId: string,
  voiceId: string,
  webhookUrl: string,
): Promise<void> {
  const voice =
    currentVoice && typeof currentVoice === "object"
      ? (currentVoice as Record<string, unknown>)
      : {};

  const nextVoice: Record<string, unknown> = {
    ...voice,
    retellAgentId:      agentId,
    retellLlmId:        llmId,
    voiceId,
    postCallWebhookUrl: webhookUrl,
  };

  await prisma.campaignBlueprint.update({
    where: { id: blueprintId },
    data: {
      voice:  nextVoice as Prisma.InputJsonValue,
      status: CampaignStatus.LIVE,
    },
  });
}

export async function provisionClientAgent(
  blueprintId: string,
  tenantId: string,
): Promise<ProvisionResult> {
  // ── Load everything (tenant-scoped) ───────────────────────────────────────
  const [blueprintRow, rep, brief] = await Promise.all([
    prisma.campaignBlueprint.findFirst({ where: { id: blueprintId, tenantId } }),
    prisma.aIRepresentative.findUnique({ where: { blueprintId } }),
    prisma.clientBrief.findUnique({ where: { blueprintId } }),
  ]);

  if (!blueprintRow) throw new Error(`Blueprint ${blueprintId} not found for this tenant`);
  if (!rep)          throw new Error(`No representative configured for blueprint ${blueprintId}`);
  if (rep.tenantId !== tenantId) throw new Error("Representative does not belong to this tenant");

  // ── Build the brief-aware system prompt ────────────────────────────────────
  const blueprint   = buildBlueprintForAssembler(blueprintRow);
  const basePrompt  = await assembleRetellPromptAsync(blueprint, rep);
  const briefBlock  = renderBriefBlock(brief);
  const systemPrompt = `${basePrompt}\n\n${briefBlock}`.trim();

  const webhookUrl = `${appBaseUrl()}/api/webhooks/calls/${blueprintId}`;

  // ── Idempotent: agent already exists → update its prompt in place ───────────
  if (rep.retellAgentId && rep.retellLlmId) {
    await updateRetellLlmPrompt(rep.retellLlmId, systemPrompt);
    await prisma.aIRepresentative.update({
      where: { blueprintId },
      data:  { lastDeployedAt: new Date() },
    });
    await persistAgentToBlueprint(
      blueprintId, blueprintRow.voice, rep.retellAgentId, rep.retellLlmId, rep.voiceId, webhookUrl,
    );
    return { agentId: rep.retellAgentId, llmId: rep.retellLlmId, created: false };
  }

  // ── Create: LLM (holds prompt) → agent (binds voice + webhook) ──────────────
  const beginMessage = `Hi, this is ${rep.repName} calling from ${blueprintRow.businessName}. How are you today?`;
  const { llmId }   = await createRetellLlm({ generalPrompt: systemPrompt, beginMessage });
  const { agentId } = await createRetellAgent({
    llmId,
    voiceId:    rep.voiceId,
    agentName:  `${rep.repName} — ${blueprintRow.businessName}`,
    webhookUrl,
  });

  await prisma.aIRepresentative.update({
    where: { blueprintId },
    data:  { retellAgentId: agentId, retellLlmId: llmId, lastDeployedAt: new Date() },
  });
  await persistAgentToBlueprint(blueprintId, blueprintRow.voice, agentId, llmId, rep.voiceId, webhookUrl);

  return { agentId, llmId, created: true };
}
