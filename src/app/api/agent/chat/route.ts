/**
 * POST /api/agent/chat
 *
 * Conversational interface with the AI agent for a given blueprint.
 * Detects standing instructions, saves them, and streams a response via SSE.
 */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import {
  getCampaignInsights,
} from "@/lib/services/metaAdsService";
import { clientAgentPersona } from "@/lib/agents/clientAgent";
import { buildClientContext } from "@/lib/agents/clientContext";

export const dynamic = "force-dynamic";

// Meta Insights API returns numeric fields as strings
interface MetaInsightsRow {
  spend:       string;
  impressions: string;
  ctr:         string;
  actions?:    Array<{ action_type: string; value: string }>;
}
interface MetaInsightsResponse {
  data?: MetaInsightsRow[];
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

export async function POST(req: NextRequest): Promise<Response> {
  // ── 1. Auth check ─────────────────────────────────────────────────────────
  const { userId, orgId } = await auth();
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OpenAI not configured" }), { status: 500 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  const body = (await req.json()) as { blueprintId?: string; message?: string };
  const { blueprintId, message } = body;

  if (!blueprintId || !message) {
    return new Response(JSON.stringify({ error: "Missing required fields: blueprintId, message" }), { status: 400 });
  }

  // ── 3. Fetch data in parallel ─────────────────────────────────────────────
  const [blueprint, recentActions, activeInstructions, repRow, clientContext] = await Promise.all([
    prisma.campaignBlueprint.findFirst({
      where: { id: blueprintId, tenantId },
      select: {
        id:             true,
        tenantId:       true,
        businessName:   true,
        vertical:       true,
        mediaBuying:    true,
        dailyBudgetUsd: true,
      },
    }),
    prisma.agentAction.findMany({
      where:   { blueprintId, tenantId },
      orderBy: { executedAt: "desc" },
      take:    5,
    }),
    prisma.agentInstruction.findMany({
      where:   { blueprintId, tenantId, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.aIRepresentative.findUnique({
      where:  { blueprintId },
      select: { repName: true },
    }),
    buildClientContext(blueprintId),
  ]);

  if (!blueprint) {
    return new Response(JSON.stringify({ error: "Blueprint not found" }), { status: 404 });
  }

  const agentName = repRow?.repName ?? "Your Agent";

  // ── 4. Detect if message is a standing instruction ────────────────────────
  let instructionSaved = false;
  let savedInstructionText: string | null = null;

  try {
    const detectCompletion = await openai.chat.completions.create({
      model:           "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role:    "system",
          content: "Detect if this message from an agency owner is a standing instruction for how to manage their ad campaign. Return JSON only.",
        },
        {
          role:    "user",
          content: `Message: ${message}\n\nReturn: { "isInstruction": boolean, "instructionText": string | null }`,
        },
      ],
    });

    const raw    = detectCompletion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { isInstruction?: boolean; instructionText?: string | null };

    if (parsed.isInstruction === true && parsed.instructionText) {
      savedInstructionText = parsed.instructionText;
      await prisma.agentInstruction.create({
        data: { tenantId, blueprintId, instruction: parsed.instructionText },
      });
      instructionSaved = true;
    }
  } catch {
    // Non-critical — continue without instruction detection
  }

  // ── 5. Fetch Meta campaign metrics ────────────────────────────────────────
  let spend       = "unavailable";
  let leads       = "unavailable";
  let cpl         = "unavailable";
  let ctr         = "unavailable";
  let impressions = "unavailable";

  try {
    const mediaBuying    = blueprint.mediaBuying as Record<string, unknown>;
    const metaAdIds      = (mediaBuying.metaAdIds ?? {}) as Record<string, unknown>;
    const metaCampaignId = typeof metaAdIds.campaignId === "string" ? metaAdIds.campaignId : null;

    if (metaCampaignId) {
      const now       = new Date();
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const insightsRaw = (await getCampaignInsights(
        metaCampaignId,
        { since: formatDate(twoDaysAgo), until: formatDate(now) },
        tenantId
      )) as MetaInsightsResponse;

      const row: MetaInsightsRow = insightsRaw.data?.[0] ?? {
        spend: "0", impressions: "0", ctr: "0",
      };

      const spendNum       = parseFloat(row.spend       ?? "0");
      const impressionsNum = parseInt(row.impressions   ?? "0", 10);
      const ctrNum         = parseFloat(row.ctr         ?? "0");
      const leadAction     = (row.actions ?? []).find(a => a.action_type === "lead");
      const leadsNum       = leadAction ? parseInt(leadAction.value ?? "0", 10) : 0;
      const cplNum         = spendNum / Math.max(leadsNum, 1);

      spend       = `£${spendNum.toFixed(2)}`;
      leads       = String(leadsNum);
      cpl         = `£${cplNum.toFixed(2)}`;
      ctr         = `${(ctrNum * 100).toFixed(2)}%`;
      impressions = String(impressionsNum);
    }
  } catch {
    // Leave as "unavailable"
  }

  // ── 6. Build system prompt ────────────────────────────────────────────────
  const instructionNote = instructionSaved && savedInstructionText
    ? `The agency owner just gave you a new standing instruction: '${savedInstructionText}'. Acknowledge it briefly and confirm you will apply it from your next check-in.\n\n`
    : "";

  const actionsText = recentActions.length > 0
    ? recentActions.map(a => `- ${a.actionType}: ${a.reasoning}`).join("\n")
    : "No recent actions.";

  const instructionsText = activeInstructions.length > 0
    ? activeInstructions.map(i => `- ${i.instruction}`).join("\n")
    : "None set.";

  // Client Account-Manager persona + this client's brief (Build 1).
  const briefBlock = clientContext.promptBlock ? `${clientContext.promptBlock}\n\n` : "";

  const systemPrompt = `${clientAgentPersona(agentName, blueprint.businessName)} You speak in first person, are direct and confident, and always back up your statements with numbers. You are not a chatbot — you are a member of staff reporting to the agency owner.

${briefBlock}${instructionNote}Recent actions you have taken:
${actionsText}

Standing instructions from the agency owner:
${instructionsText}

Current campaign metrics (last 48h):
- Spend: ${spend}
- Leads: ${leads}
- CPL: ${cpl}
- CTR: ${ctr}
- Impressions: ${impressions}`;

  // ── 7. Stream response via SSE ────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // If instruction was saved, send the flag first
        if (instructionSaved) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ instructionSaved: true })}\n\n`)
          );
        }

        const completion = await openai.chat.completions.create({
          model:  "gpt-4o",
          stream: true,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: message },
          ],
        });

        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: `Error: ${msg}` })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
