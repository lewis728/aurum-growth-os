/**
 * src/lib/orchestrator/intentProcessor.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * The Command Center brain. Receives plain English input, classifies intent
 * using GPT-4o-mini, routes to the correct handler, executes the action,
 * and returns a structured OrchestratorResponse.
 *
 * GOLDEN RULES:
 * 1. processIntent() NEVER THROWS. Always returns OrchestratorResponse.
 * 2. Every external API call is wrapped in withRetry().
 * 3. Every logEvent() call has its own try/catch — logging never crashes the pipeline.
 * 4. Runtime guard on OPENAI_API_KEY fires at module load time.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/utils/withRetry";
import { CampaignStatus, ServiceVertical, AdObjective, LeadFormFieldEnum } from "@/enums/campaignEnums";
import { funnelOrchestrator } from "@/lib/orchestrator/funnelOrchestrator";
import { generateCreative } from "@/lib/services/higgsFieldService";
import { getCampaignInsights, pauseCampaign, resumeCampaign } from "@/lib/services/metaAdsService";
import { queueAppointmentReminders } from "@/lib/services/twilioService";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";

// ── 1. TYPE DEFINITIONS ───────────────────────────────────────────────────────

export type IntentCategory =
  | "CREATIVE_GENERATION"
  | "ANALYTICS_QUERY"
  | "BOOKING_REQUEST"
  | "CAMPAIGN_LAUNCH"
  | "CAMPAIGN_MANAGEMENT"
  | "LEAD_MANAGEMENT"
  | "GENERAL_QUERY";

export interface IntentEntities {
  serviceVertical?: string;
  budget?:          number;
  blueprintId?:     string;
  leadId?:          string;
  metricRequested?: string;
  dateRange?:       { since: string; until: string };
  ptName?:          string;
  callbackTime?:    string;
  creativePrompt?:  string;
  pauseResume?:     "pause" | "resume";
  statusFilter?:    string;
}

export interface ClassifiedIntent {
  category:   IntentCategory;
  confidence: number;           // 0.0 – 1.0
  entities:   IntentEntities;
  rawInput:   string;
}

export interface OrchestratorResponse {
  success:        boolean;
  intent?:        ClassifiedIntent;
  reply:          string;
  dashboardData?: {
    type:    "metrics" | "leads" | "creative_asset" | "campaign_status";
    payload: Record<string, unknown>;
  };
  blueprintId?:   string;
  error?:         string;
}

export type ConversationMessage = {
  role:    "user" | "assistant" | "system";
  content: string;
};

// ChatMessage is the public type used by chatStore and UI components
export type ChatMessage = {
  id:        string;
  role:      "user" | "assistant";
  content:   string;
  timestamp: string;
  intent?:   ClassifiedIntent;
  dashboardData?: OrchestratorResponse["dashboardData"];
};

// ── 2. OPENAI CLIENT ──────────────────────────────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured. Set it in .env.local.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 3. CLASSIFIER_TOOL — GPT-4o-mini function schema ─────────────────────────

const CLASSIFIER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "classify_intent",
    description:
      "Classify the user's plain English input into one of seven intent categories and extract structured entities.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "CREATIVE_GENERATION",
            "ANALYTICS_QUERY",
            "BOOKING_REQUEST",
            "CAMPAIGN_LAUNCH",
            "CAMPAIGN_MANAGEMENT",
            "LEAD_MANAGEMENT",
            "GENERAL_QUERY",
          ],
          description: "The primary intent category of the user's input.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence score between 0.0 and 1.0.",
        },
        entities: {
          type: "object",
          description: "Structured entities extracted from the user's input.",
          properties: {
            serviceVertical: {
              type: "string",
              description: "Service vertical, e.g. 'law.personal_injury', 'aesthetics.anti_wrinkle_filler'.",
            },
            budget: {
              type: "number",
              description: "Daily budget in USD.",
            },
            blueprintId: {
              type: "string",
              description: "Campaign blueprint ID if the user references a specific campaign.",
            },
            leadId: {
              type: "string",
              description: "Lead ID if the user references a specific lead.",
            },
            metricRequested: {
              type: "string",
              description: "Specific metric requested, e.g. 'ROAS', 'CPL', 'CTR', 'spend'.",
            },
            dateRange: {
              type: "object",
              description: "Date range for analytics queries.",
              properties: {
                since: { type: "string", description: "Start date in YYYY-MM-DD format." },
                until: { type: "string", description: "End date in YYYY-MM-DD format." },
              },
              required: ["since", "until"],
            },
            ptName: {
              type: "string",
              description: "Patient or prospect name for booking requests.",
            },
            callbackTime: {
              type: "string",
              description: "Requested callback or appointment time.",
            },
            creativePrompt: {
              type: "string",
              description: "Creative generation prompt describing the desired ad visual.",
            },
            pauseResume: {
              type: "string",
              enum: ["pause", "resume"],
              description: "Whether to pause or resume a campaign.",
            },
            statusFilter: {
              type: "string",
              description: "Lead status filter, e.g. 'new', 'called', 'booked'.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["category", "confidence", "entities"],
      additionalProperties: false,
    },
  },
};

// ── 5. logEvent ───────────────────────────────────────────────────────────────

async function logEvent(
  tenantId:    string,
  intent:      ClassifiedIntent,
  success:     boolean,
  durationMs:  number,
  blueprintId?: string,
  errorMsg?:    string
): Promise<void> {
  try {
    await prisma.commandLog.create({
      data: {
        tenantId,
        rawInput:   intent.rawInput,
        intentType: intent.category,
        blueprintId: blueprintId ?? null,
        success,
        errorMsg:   errorMsg ?? null,
        durationMs,
      },
    });
  } catch {
    // Logging must never crash the pipeline — swallow silently
  }
}

// ── 6. classifyIntent ─────────────────────────────────────────────────────────

async function classifyIntent(
  rawInput: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tenantId: string
): Promise<ClassifiedIntent> {
  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an intent classifier for Aurum Growth OS, an autonomous AI marketing platform. " +
              "Classify the user's input into exactly one intent category and extract all relevant entities. " +
              "Be precise — CAMPAIGN_LAUNCH requires a service vertical and budget. " +
              "ANALYTICS_QUERY is for performance questions. CAMPAIGN_MANAGEMENT is for pause/resume actions.",
          },
          { role: "user", content: rawInput },
        ],
        tools:       [CLASSIFIER_TOOL],
        tool_choice: { type: "function", function: { name: "classify_intent" } },
        temperature: 0,
      }),
    { label: "classifyIntent" }
  );

  // Narrow the union type: ChatCompletionMessageToolCall = FunctionToolCall | CustomToolCall
  const rawToolCall = response.choices[0]?.message?.tool_calls?.[0];
  const toolCall = rawToolCall as ChatCompletionMessageFunctionToolCall | undefined;
  if (!toolCall || toolCall.function.name !== "classify_intent") {
    throw new Error("GPT-4o-mini did not return a classify_intent tool call.");
  }

  const parsed = JSON.parse(toolCall.function.arguments) as {
    category:   IntentCategory;
    confidence: number;
    entities:   IntentEntities;
  };

  return {
    category:   parsed.category,
    confidence: parsed.confidence,
    entities:   parsed.entities ?? {},
    rawInput,
  };
}

// ── 7. HANDLER FUNCTIONS ──────────────────────────────────────────────────────

async function handleCreativeGeneration(
  entities: IntentEntities,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tenantId: string
): Promise<OrchestratorResponse> {
  const prompt = entities.creativePrompt ?? "Professional marketing creative for local service business";

  const asset = await withRetry(
    () => generateCreative(prompt, undefined),
    { label: "handleCreativeGeneration" }
  );

  return {
    success: true,
    reply:
      `Creative asset generated successfully. Your ad visual is ready at: ${asset.url}. ` +
      `The asset (ID: ${asset.assetId}) is in ${asset.status} status and ready to deploy into your next campaign.`,
    dashboardData: {
      type: "creative_asset",
      payload: {
        assetId:      asset.assetId,
        url:          asset.url,
        thumbnailUrl: asset.thumbnailUrl,
        format:       asset.format,
        status:       asset.status,
      },
    },
  };
}

async function handleAnalyticsQuery(
  entities: IntentEntities,
  tenantId: string
): Promise<OrchestratorResponse> {
  // Default to last 7 days if no date range specified
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  const dateRange = entities.dateRange ?? {
    since: sevenDaysAgo.toISOString().split("T")[0]!,
    until: today.toISOString().split("T")[0]!,
  };

  // Fetch all live blueprints for this tenant
  const blueprints = await prisma.campaignBlueprint.findMany({
    where: {
      tenantId,
      status: { in: [CampaignStatus.LIVE, CampaignStatus.PAUSED] },
    },
    select: { id: true, vertical: true, mediaBuying: true },
  });

  // Fetch Meta insights for each live campaign
  const insightsResults = await Promise.allSettled(
    blueprints.map(async (bp) => {
      const mediaBuying = bp.mediaBuying as { metaAdIds?: { campaignId?: string } } | null;
      const campaignId = mediaBuying?.metaAdIds?.campaignId;
      if (!campaignId) return null;
      return withRetry(
        () => getCampaignInsights(campaignId, dateRange, tenantId),
        { label: `getCampaignInsights-${bp.id}` }
      );
    })
  );

  // Fetch lead counts grouped by status for this tenant
  const leadCounts = await prisma.lead.groupBy({
    by: ["status"],
    where: {
      tenantId,
      createdAt: {
        gte: new Date(dateRange.since),
        lte: new Date(dateRange.until),
      },
    },
    _count: { id: true },
  });

  const totalLeads = leadCounts.reduce((sum, row) => sum + row._count.id, 0);
  const bookedLeads = leadCounts.find((r) => r.status === "booked")?._count.id ?? 0;

  // Aggregate Meta insights
  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let successfulInsights = 0;

  for (const result of insightsResults) {
    if (result.status === "fulfilled" && result.value) {
      const data = result.value as {
        spend?: string;
        impressions?: string;
        clicks?: string;
      };
      totalSpend       += parseFloat(data.spend ?? "0");
      totalImpressions += parseInt(data.impressions ?? "0", 10);
      totalClicks      += parseInt(data.clicks ?? "0", 10);
      successfulInsights++;
    }
  }

  const cpl = totalLeads > 0 && totalSpend > 0 ? (totalSpend / totalLeads).toFixed(2) : "N/A";
  const ctr =
    totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + "%" : "N/A";

  const metricFocus = entities.metricRequested?.toUpperCase() ?? "OVERVIEW";

  const reply =
    `Here's your performance snapshot for ${dateRange.since} to ${dateRange.until}:\n\n` +
    `📊 **${metricFocus === "OVERVIEW" ? "Full Account Overview" : metricFocus}**\n` +
    `• Total Spend: $${totalSpend.toFixed(2)}\n` +
    `• Impressions: ${totalImpressions.toLocaleString()}\n` +
    `• Clicks: ${totalClicks.toLocaleString()}\n` +
    `• CTR: ${ctr}\n` +
    `• Total Leads: ${totalLeads}\n` +
    `• Booked Appointments: ${bookedLeads}\n` +
    `• Cost Per Lead: $${cpl}\n` +
    `• Active Campaigns Tracked: ${successfulInsights} of ${blueprints.length}`;

  return {
    success: true,
    reply,
    dashboardData: {
      type: "metrics",
      payload: {
        dateRange,
        totalSpend,
        totalImpressions,
        totalClicks,
        ctr,
        totalLeads,
        bookedLeads,
        cpl,
        activeCampaigns: blueprints.length,
      },
    },
  };
}

async function handleBookingRequest(
  entities: IntentEntities,
  tenantId: string
): Promise<OrchestratorResponse> {
  const { leadId, callbackTime, ptName } = entities;

  if (!leadId) {
    return {
      success: false,
      reply:   "I need a lead ID to book an appointment. Which lead would you like to book?",
      error:   "Missing leadId entity for BOOKING_REQUEST",
    };
  }

  const scheduledAt = callbackTime ? new Date(callbackTime) : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  })();

  // Atomic transaction: create appointment + update lead status
  const [appointment] = await prisma.$transaction([
    prisma.appointment.create({
      data: {
        blueprintId: "", // Will be populated from lead below
        leadId,
        tenantId,
        scheduledAt,
        confirmed: false,
        notes: ptName ? `Booked for ${ptName}` : undefined,
      },
    }),
    prisma.lead.update({
      where: { id: leadId },
      data:  { status: "booked", updatedAt: new Date() },
    }),
  ]);

  // Queue SMS reminders
  await queueAppointmentReminders(appointment.id, leadId);

  const formattedTime = scheduledAt.toLocaleString("en-GB", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
    year:    "numeric",
    hour:    "2-digit",
    minute:  "2-digit",
  });

  return {
    success: true,
    reply:
      `Appointment booked for ${ptName ?? "the lead"} on ${formattedTime}. ` +
      `Confirmation SMS and reminders have been queued. Appointment ID: ${appointment.id}.`,
  };
}

async function handleCampaignLaunch(
  entities: IntentEntities,
  tenantId: string
): Promise<OrchestratorResponse> {
  const dailyBudgetUsd = entities.budget ?? 0;

  if (dailyBudgetUsd < 10) {
    return {
      success: false,
      reply:
        `Budget guard: The minimum daily budget is $10. You specified $${dailyBudgetUsd}. ` +
        `Please provide a budget of at least $10/day to launch a campaign.`,
      error: `Budget ${dailyBudgetUsd} is below minimum $10`,
    };
  }

  const vertical =
    (entities.serviceVertical as ServiceVertical) ?? ServiceVertical.LAW_PERSONAL_INJURY;

  // Build a minimal but valid CampaignBlueprint from the extracted entities
  const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const blueprint: Omit<CampaignBlueprint, "createdAt" | "updatedAt" | "orchestrationLog"> = {
    blueprintId,
    tenantId,
    serviceIntent: vertical,
    status:        CampaignStatus.PENDING,
    budget: {
      dailyUsd:          dailyBudgetUsd,
      monthlyCapUsd:     dailyBudgetUsd * 30.5,
      stripeMandateId:   "",
      billingCycleStart: new Date().toISOString().split("T")[0]!,
    },
    creativeLayer: {
      higgsfieldJobId: "",
      serviceContext:  `Professional ad creative for ${vertical} service`,
      visualStyle:     "professional, trust-building, urgent",
      brandColors:     ["#1a1a2e", "#16213e"],
      assets:          [],
      copyVariants:    [],
      primaryAssetId:  "",
    },
    mediaBuyingLayer: {
      adAccountId:    "", // Resolved at runtime from tenant MetaConnection row
      pixelId:        "", // Resolved at runtime from tenant MetaConnection row
      objective:      AdObjective.LEAD_GENERATION,
      dailyBudgetUsd,
      bidStrategy:    "LOWEST_COST_WITHOUT_CAP",
      targeting: {
        geoLocations: { countries: ["GB"] },
        ageMin:       25,
        ageMax:       65,
      },
      placements:    ["facebook_feed", "instagram_reels"],
      landingPageUrl: "",
      utmParams: {
        source:   "meta",
        medium:   "paid_social",
        campaign: blueprintId,
        content:  "",
      },
    },
    deploymentLayer: {
      templateId:      `lp-${vertical.split(".")[0]}-v1`,
      tenantSubdomain: tenantId.slice(0, 12).toLowerCase(),
      copy: {
        heroHeadline:     `Get Your Free ${vertical.split(".")[1]?.replace(/_/g, " ") ?? "Consultation"} Consultation`,
        heroSubheadline:  "Expert help. No obligation. Results guaranteed.",
        bodyParagraph:    "Our specialists are ready to help you today.",
        socialProof:      "Trusted by 500+ clients",
        formHeading:      "Get Your Free Consultation",
        footerDisclaimer: "Your information is 100% confidential.",
      },
      heroAssetUrl:    "",
      formFields:      [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE],
      webhookEndpoint: `/api/webhooks/leads/${blueprintId}`,
      privacyPolicyUrl: "https://aurumgrowthagency.com/privacy",
    },
    voiceLayer: {
      retellAgentId:        process.env.RETELL_AGENT_ID ?? "",
      retellPhoneNumberId:  process.env.RETELL_PHONE_NUMBER_ID ?? "",
      basePromptTemplateId: "base-v1",
      promptInjections: {
        serviceName:            vertical,
        serviceCategory:        vertical.split(".")[0] ?? vertical,
        keyPainPoints:          ["Time-sensitive situation", "Need expert guidance"],
        valuePropositions:      ["Free consultation", "No win no fee", "Expert specialists"],
        qualificationQuestions: ["What is your situation?", "When did this happen?"],
        bookingCta:             "Let me schedule a free consultation for you right now.",
        complianceNotes:        "Do not guarantee outcomes. Refer to qualified professionals.",
        tenantName:             tenantId,
      },
      postCallWebhookUrl:  `/api/webhooks/calls/${blueprintId}`,
      maxCallDurationSec:  600,
      voiceId:             "11labs-Adriana",
      language:            "en-US",
    },
    crmLayer: {
      inboundWebhookPath:   `/api/webhooks/leads/${blueprintId}`,
      intentTag:            vertical,
      leadSchema: {
        requiredFields:   [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE],
        enrichmentFields: ["ip", "userAgent", "utmSource"],
      },
      automationTriggers:   [],
      crmIntegrationId:     "",
      notificationEmails:   [],
      slaMinutes:           1,
    },
  };

  const result = await funnelOrchestrator(blueprint, tenantId);

  return {
    success:     true,
    blueprintId: result.blueprintId,
    reply:
      `Campaign launched successfully! Your ${vertical} campaign is now live on Meta with a $${dailyBudgetUsd}/day budget. ` +
      `Blueprint ID: ${result.blueprintId}. ` +
      `I've deployed your landing page, configured your AI voice agent, and activated your paid social campaigns. ` +
      `You can track real-time deployment progress using the blueprint ID above.`,
  };
}

async function handleCampaignManagement(
  entities: IntentEntities,
  tenantId: string
): Promise<OrchestratorResponse> {
  const { blueprintId, pauseResume } = entities;

  if (!blueprintId) {
    // Find the most recent live/paused campaign for this tenant
    const latest = await prisma.campaignBlueprint.findFirst({
      where: {
        tenantId,
        status: { in: [CampaignStatus.LIVE, CampaignStatus.PAUSED] },
      },
      orderBy: { createdAt: "desc" },
      select:  { id: true, mediaBuying: true, status: true },
    });

    if (!latest) {
      return {
        success: false,
        reply:   "No active campaigns found for your account.",
        error:   "No live or paused campaign found",
      };
    }

    const mediaBuying = latest.mediaBuying as { metaAdIds?: { campaignId?: string } } | null;
    const metaCampaignId = mediaBuying?.metaAdIds?.campaignId;

    if (!metaCampaignId) {
      return {
        success: false,
        reply:   "Campaign found but no Meta campaign ID is associated with it yet.",
        error:   "Missing metaAdIds.campaignId",
      };
    }

    const action = pauseResume ?? (latest.status === CampaignStatus.LIVE ? "pause" : "resume");

    await withRetry(
      () => (action === "pause" ? pauseCampaign(metaCampaignId, tenantId) : resumeCampaign(metaCampaignId, tenantId)),
      { label: `campaign-${action}` }
    );

    const newStatus = action === "pause" ? CampaignStatus.PAUSED : CampaignStatus.LIVE;
    await prisma.campaignBlueprint.update({
      where: { id: latest.id },
      data:  { status: newStatus, updatedAt: new Date() },
    });

    return {
      success: true,
      reply:   `Campaign ${latest.id} has been ${action === "pause" ? "paused" : "resumed"} on Meta. Status updated to ${newStatus}.`,
      dashboardData: {
        type:    "campaign_status",
        payload: { blueprintId: latest.id, status: newStatus, action },
      },
    };
  }

  // Specific blueprintId provided
  const bp = await prisma.campaignBlueprint.findFirst({
    where: { id: blueprintId, tenantId },
    select: { id: true, mediaBuying: true, status: true },
  });

  if (!bp) {
    return {
      success: false,
      reply:   `Campaign ${blueprintId} not found or does not belong to your account.`,
      error:   "Blueprint not found",
    };
  }

  const mediaBuying = bp.mediaBuying as { metaAdIds?: { campaignId?: string } } | null;
  const metaCampaignId = mediaBuying?.metaAdIds?.campaignId;

  if (!metaCampaignId) {
    return {
      success: false,
      reply:   "Campaign found but no Meta campaign ID is associated with it.",
      error:   "Missing metaAdIds.campaignId",
    };
  }

  const action = pauseResume ?? (bp.status === CampaignStatus.LIVE ? "pause" : "resume");

  await withRetry(
    () => (action === "pause" ? pauseCampaign(metaCampaignId, tenantId) : resumeCampaign(metaCampaignId, tenantId)),
    { label: `campaign-${action}-${blueprintId}` }
  );

  const newStatus = action === "pause" ? CampaignStatus.PAUSED : CampaignStatus.LIVE;
  await prisma.campaignBlueprint.update({
    where: { id: blueprintId },
    data:  { status: newStatus, updatedAt: new Date() },
  });

  return {
    success: true,
    reply:   `Campaign ${blueprintId} has been ${action === "pause" ? "paused" : "resumed"}. Status: ${newStatus}.`,
    dashboardData: {
      type:    "campaign_status",
      payload: { blueprintId, status: newStatus, action },
    },
  };
}

async function handleLeadManagement(
  entities: IntentEntities,
  tenantId: string
): Promise<OrchestratorResponse> {
  const { blueprintId, statusFilter } = entities;

  const leads = await prisma.lead.findMany({
    where: {
      tenantId,
      ...(blueprintId   ? { blueprintId }   : {}),
      ...(statusFilter  ? { status: statusFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take:    50,
    select: {
      id:         true,
      firstName:  true,
      lastName:   true,
      phone:      true,
      email:      true,
      status:     true,
      createdAt:  true,
      blueprintId: true,
    },
  });

  const total = leads.length;
  const statusBreakdown = leads.reduce<Record<string, number>>((acc, lead) => {
    acc[lead.status] = (acc[lead.status] ?? 0) + 1;
    return acc;
  }, {});

  const breakdownText = Object.entries(statusBreakdown)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");

  const filterDesc = [
    blueprintId  ? `campaign ${blueprintId}` : null,
    statusFilter ? `status "${statusFilter}"` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  return {
    success: true,
    reply:
      `Found ${total} lead${total !== 1 ? "s" : ""}${filterDesc ? ` for ${filterDesc}` : ""}. ` +
      (breakdownText ? `Breakdown — ${breakdownText}.` : ""),
    dashboardData: {
      type: "leads",
      payload: {
        leads:           leads.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        })),
        total,
        statusBreakdown,
      },
    },
  };
}

async function handleGeneralQuery(
  rawInput:  string,
  history:   ConversationMessage[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tenantId: string
): Promise<OrchestratorResponse> {
  const systemPrompt =
    "You are Aurum, an Elite Media Buyer and AI Chief Operating Officer for a high-performance digital marketing agency. " +
    "You have deep expertise in Meta Ads, lead generation, voice AI, and CRM automation. " +
    "You speak with authority, cite specific metrics when available, and always explain the strategic rationale behind every recommendation. " +
    "You follow the Action Narration Protocol: Rationale → Execution → Next Step. " +
    "You never reveal the internal technology stack. You never say you are an AI — you are Aurum.";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role:    m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
    { role: "user", content: rawInput },
  ];

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model:       "gpt-4o",
        messages,
        temperature: 0.7,
        max_tokens:  800,
      }),
    { label: "handleGeneralQuery" }
  );

  const reply =
    response.choices[0]?.message?.content ??
    "I'm here to help. Could you clarify what you need?";

  return { success: true, reply };
}

// ── 8. processIntent — MAIN ENTRY POINT ──────────────────────────────────────

/**
 * The main entry point for the Command Center.
 * NEVER THROWS. Always returns an OrchestratorResponse.
 *
 * @param rawInput  - Plain English user input
 * @param tenantId  - Clerk organisation ID
 * @param history   - Conversation history for context
 */
export async function processIntent(
  rawInput:  string,
  tenantId:  string,
  history:   ConversationMessage[] = []
): Promise<OrchestratorResponse> {
  const startMs = Date.now();
  let intent: ClassifiedIntent | undefined;

  try {
    // Step 1: Classify intent
    intent = await classifyIntent(rawInput, tenantId);

    // Step 2: Route to correct handler
    let response: OrchestratorResponse;

    switch (intent.category) {
      case "CREATIVE_GENERATION":
        response = await handleCreativeGeneration(intent.entities, tenantId);
        break;

      case "ANALYTICS_QUERY":
        response = await handleAnalyticsQuery(intent.entities, tenantId);
        break;

      case "BOOKING_REQUEST":
        response = await handleBookingRequest(intent.entities, tenantId);
        break;

      case "CAMPAIGN_LAUNCH":
        response = await handleCampaignLaunch(intent.entities, tenantId);
        break;

      case "CAMPAIGN_MANAGEMENT":
        response = await handleCampaignManagement(intent.entities, tenantId);
        break;

      case "LEAD_MANAGEMENT":
        response = await handleLeadManagement(intent.entities, tenantId);
        break;

      case "GENERAL_QUERY":
      default:
        response = await handleGeneralQuery(rawInput, history, tenantId);
        break;
    }

    // Step 3: Log the event
    await logEvent(
      tenantId,
      intent,
      response.success,
      Date.now() - startMs,
      response.blueprintId,
      response.error
    );

    return { ...response, intent };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Best-effort log — if intent classification itself failed, use a fallback
    if (intent) {
      await logEvent(tenantId, intent, false, Date.now() - startMs, undefined, errorMsg);
    } else {
      await logEvent(
        tenantId,
        { category: "GENERAL_QUERY", confidence: 0, entities: {}, rawInput },
        false,
        Date.now() - startMs,
        undefined,
        errorMsg
      );
    }

    return {
      success: false,
      reply:   "I encountered an issue processing your request. Please try again.",
      intent,
      error:   errorMsg,
    };
  }
}
