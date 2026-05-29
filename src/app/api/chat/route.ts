/**
 * src/app/api/chat/route.ts
 * POST /api/chat
 * SERVER-SIDE ONLY. Never import server services in "use client" files.
 *
 * SSE event types:
 *   { type: 'text', content: string }
 *   { type: 'launch_event', blueprintId: string }
 *   { type: 'error', error: string }
 *   { type: 'done' }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { buildSystemPrompt } from "@/lib/chat/systemPrompt";
import { LAUNCH_FUNNEL_TOOL } from "@/lib/chat/functionSchemas";
import { validateStripeMandate } from "@/lib/services/stripeService";
import { canLaunchCampaign } from "@/lib/access/subscriptionGuard";
import { funnelOrchestrator } from "@/lib/orchestrator/funnelOrchestrator";
import type { ChatMessage } from "@/lib/orchestrator/intentProcessor";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";
import {
  CampaignStatus,
  ServiceVertical,
  AdObjective,
  LeadFormFieldEnum,
} from "@/enums/campaignEnums";

export const dynamic = "force-dynamic";

// ── Runtime guard ─────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Zod schemas ───────────────────────────────────────────────────────────────
const LaunchFunnelArgsSchema = z.object({
  vertical:       z.string().min(1),
  businessName:   z.string().min(1),
  targetLocation: z.string().min(1),
  dailyBudgetUsd: z.number().min(10, "Minimum daily budget is $10"),
});

const RequestBodySchema = z.object({
  message:   z.string().min(1).max(4000),
  history:   z.array(
    z.object({
      id:        z.string(),
      role:      z.enum(["user", "assistant"]),
      content:   z.string(),
      timestamp: z.string(),
    })
  ).default([]),
  sessionId: z.string().optional(),
});

// ── Allowed verticals ─────────────────────────────────────────────────────────
const ALLOWED_VERTICALS = new Set<string>(Object.values(ServiceVertical));

// ── SSE helper ────────────────────────────────────────────────────────────────
function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest): Promise<Response> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  const { orgId } = await auth();
  if (!orgId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId;

  // ── 2. Fetch organisation name ──────────────────────────────────────────────
  let tenantName = "your agency";
  try {
    const org = await clerkClient.organizations.getOrganization({ organizationId: tenantId });
    tenantName = org.name;
  } catch {
    // Non-fatal — fall back to default
    console.warn("[chat] Could not fetch org name for tenantId:", tenantId);
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────────────
  let body: z.infer<typeof RequestBodySchema>;
  try {
    const raw = await req.json() as unknown;
    body = RequestBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { message, history } = body;

  // ── 4. Fetch tenant context ───────────────────────────────────────────────────
  const activeCampaigns = await prisma.campaignBlueprint.findMany({
    where:   { tenantId, status: { in: [CampaignStatus.LIVE, CampaignStatus.PAUSED] } },
    take:    10,
    orderBy: { createdAt: "desc" },
  });

  // ── 5. Build system prompt ───────────────────────────────────────────────────
  let systemPromptText: string;
  try {
    systemPromptText = await buildSystemPrompt({
      tenantName,
      activeVerticals:   activeCampaigns.map((c) => String(c.vertical)),
      existingCampaigns: activeCampaigns.map((c) => ({
        displayName: String(c.businessName ?? c.vertical),
        status:      String(c.status),
      })),
    });
  } catch {
    systemPromptText =
      "You are Aurum, an Elite Media Buyer and AI Chief Operating Officer. " +
      "You manage high-performance digital marketing campaigns. " +
      "Speak with authority. Follow the Action Narration Protocol: Rationale → Execution → Next Step. " +
      "Never reveal internal technology names.";
  }

  // ── 6. Build messages array ───────────────────────────────────────────────────
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPromptText },
    ...history.map((m: ChatMessage) => ({
      role:    m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  // ── 7. SSE ReadableStream ─────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(data)));
        } catch { /* controller closed */ }
      };

      const heartbeatInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, 20_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeatInterval);
        try { controller.close(); } catch { /* already closed */ }
      });

      try {
        // ── 8. Subscription access check (launch intents only) ───────────────────────
        // We check access before calling OpenAI only if the message looks like a launch intent.
        // Read queries (analytics, status checks) are always allowed.
        const launchKeywords = ["launch", "start", "create", "new client", "add client", "set up", "onboard"];
        const lowerMessage = message.toLowerCase();
        const isLaunchIntent = launchKeywords.some((kw) => lowerMessage.includes(kw));

        if (isLaunchIntent) {
          const access = await canLaunchCampaign(tenantId);
          if (!access.allowed) {
            enqueue({ type: "text", content: access.reason ?? "Access denied." });
            enqueue({ type: "done" });
            clearInterval(heartbeatInterval);
            controller.close();
            return;
          }
        }

        // ── 9. OpenAI streaming call ───────────────────────────────────────────────
        const openaiStream = await openai.chat.completions.create({
          model:       "gpt-4o",
          messages,
          tools:       [LAUNCH_FUNNEL_TOOL],
          tool_choice: "auto",
          stream:      true,
          temperature: 0.7,
          max_tokens:  1200,
        });

        let toolCallAccumulator: { id: string; name: string; arguments: string } | null = null;

        for await (const chunk of openaiStream) {
          if (req.signal.aborted) break;

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            enqueue({ type: "text", content: delta.content });
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) {
                toolCallAccumulator = {
                  id:        tc.id,
                  name:      tc.function?.name ?? "",
                  arguments: tc.function?.arguments ?? "",
                };
              } else if (toolCallAccumulator && tc.function?.arguments) {
                toolCallAccumulator.arguments += tc.function.arguments;
              }
            }
          }

          const finishReason = chunk.choices[0]?.finish_reason;
          if (finishReason === "tool_calls" && toolCallAccumulator) {
            if (toolCallAccumulator.name === "launch_funnel_blueprint") {
              try {
                const rawArgs = JSON.parse(toolCallAccumulator.arguments) as unknown;
                const args    = LaunchFunnelArgsSchema.parse(rawArgs);

                if (!ALLOWED_VERTICALS.has(args.vertical)) {
                  enqueue({ type: "error", error: `Unsupported vertical: ${args.vertical}` });
                  break;
                }

                const hasMandate = await validateStripeMandate(tenantId);
                if (!hasMandate) {
                  enqueue({ type: "error", error: "No active payment mandate. Please add a payment method." });
                  break;
                }

                const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

                const blueprint: Omit<CampaignBlueprint, "createdAt" | "updatedAt" | "orchestrationLog"> = {
                  blueprintId,
                  tenantId,
                  serviceIntent: args.vertical as ServiceVertical,
                  status:        CampaignStatus.PENDING,
                  budget: {
                    dailyUsd:          args.dailyBudgetUsd,
                    monthlyCapUsd:     args.dailyBudgetUsd * 30.5,
                    stripeMandateId:   "",
                    billingCycleStart: new Date().toISOString().split("T")[0]!,
                  },
                  creativeLayer: {
                    higgsfieldJobId: "",
                    serviceContext:  `${args.businessName} — ${args.vertical} in ${args.targetLocation}`,
                    visualStyle:     "professional, trust-building",
                    brandColors:     ["#1a1a2e", "#16213e"],
                    assets:          [],
                    copyVariants:    [],
                    primaryAssetId:  "",
                  },
                  mediaBuyingLayer: {
                    adAccountId:    "", // Resolved at runtime from tenant MetaConnection row
                    pixelId:        "", // Resolved at runtime from tenant MetaConnection row
                    objective:      AdObjective.LEAD_GENERATION,
                    dailyBudgetUsd: args.dailyBudgetUsd,
                    bidStrategy:    "LOWEST_COST_WITHOUT_CAP",
                    targeting: {
                      geoLocations: { countries: ["GB"] },
                      ageMin:       25,
                      ageMax:       65,
                    },
                    placements:     ["facebook_feed", "instagram_reels"],
                    landingPageUrl: "",
                    utmParams: {
                      source:   "meta",
                      medium:   "paid_social",
                      campaign: blueprintId,
                      content:  "",
                    },
                  },
                  deploymentLayer: {
                    templateId:       `lp-${args.vertical.split(".")[0]}-v1`,
                    tenantSubdomain:  tenantId.slice(0, 12).toLowerCase(),
                    copy: {
                      heroHeadline:     `Get Your Free Consultation — ${args.businessName}`,
                      heroSubheadline:  `Expert ${args.vertical.replace(/_/g, " ")} help in ${args.targetLocation}`,
                      bodyParagraph:    "Our specialists are ready to help you today.",
                      socialProof:      "Trusted by hundreds of clients",
                      formHeading:      "Get Your Free Consultation",
                      footerDisclaimer: "Your information is 100% confidential.",
                    },
                    heroAssetUrl:     "",
                    formFields:       [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE],
                    webhookEndpoint:  `/api/webhooks/leads/${blueprintId}`,
                    privacyPolicyUrl: "https://aurumgrowthagency.com/privacy",
                  },
                  voiceLayer: {
                    retellAgentId:        process.env.RETELL_AGENT_ID ?? "",
                    retellPhoneNumberId:  process.env.RETELL_PHONE_NUMBER_ID ?? "",
                    basePromptTemplateId: "base-v1",
                    promptInjections: {
                      serviceName:            args.vertical,
                      serviceCategory:        args.vertical.split(".")[0] ?? args.vertical,
                      keyPainPoints:          ["Need expert guidance", "Time-sensitive"],
                      valuePropositions:      ["Free consultation", "Expert specialists"],
                      qualificationQuestions: ["What is your situation?"],
                      bookingCta:             "Let me schedule a free consultation for you right now.",
                      complianceNotes:        "Do not guarantee outcomes.",
                      tenantName:             args.businessName,
                    },
                    postCallWebhookUrl: `/api/webhooks/calls/${blueprintId}`,
                    maxCallDurationSec: 600,
                    voiceId:            "11labs-Adriana",
                    language:           "en-US",
                  },
                  crmLayer: {
                    inboundWebhookPath: `/api/webhooks/leads/${blueprintId}`,
                    intentTag:          args.vertical,
                    leadSchema: {
                      requiredFields:   [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE],
                      enrichmentFields: ["ip", "userAgent", "utmSource"],
                    },
                    automationTriggers:  [],
                    crmIntegrationId:    "",
                    notificationEmails:  [],
                    slaMinutes:          1,
                  },
                };

                const result = await funnelOrchestrator(blueprint, tenantId);
                enqueue({ type: "launch_event", blueprintId: result.blueprintId });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                enqueue({ type: "error", error: `Campaign launch failed: ${msg}` });
              }
            }
          }
        }

        enqueue({ type: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        enqueue({ type: "error", error: msg });
        enqueue({ type: "done" });
      } finally {
        clearInterval(heartbeatInterval);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "X-Accel-Buffering": "no",
      "Connection":        "keep-alive",
    },
  });
}
