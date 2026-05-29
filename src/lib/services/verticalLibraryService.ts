/**
 * src/lib/services/verticalLibraryService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Vertical Intelligence Library — living database of niche knowledge.
 * Seeded with 20 profiles at launch; new verticals auto-generated via GPT-4o.
 *
 * EXPORTED FUNCTIONS:
 *   getVerticalProfile(vertical)                    — DB lookup, null if not found
 *   generateVerticalProfile(businessType, vertical) — GPT-4o generation + DB save
 *   getOrGenerateVerticalProfile(vertical, type)    — Primary function for callers
 *   updateVerticalPerformanceData(vertical, data)   — Feedback loop append
 *
 * GOLDEN RULES:
 *   1. getOrGenerateVerticalProfile() NEVER THROWS. Returns a sensible default on error.
 *   2. All GPT calls wrapped in withRetry(3, 500ms).
 *   3. performanceData is append-only — never overwrite, always merge.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { withRetry } from "@/lib/utils/withRetry";
import { ServiceVertical } from "@/enums/campaignEnums";
import type { VerticalProfile } from "@prisma/client";

// ── OpenAI Client ─────────────────────────────────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── GBP → USD Rate ────────────────────────────────────────────────────────────

const GBP_TO_USD_RATE = 1.27;

// ── GPT-4o Tool Schema ────────────────────────────────────────────────────────

const GENERATE_PROFILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_vertical_profile",
    description:
      "Create a complete vertical intelligence profile for a business type. " +
      "All CPL benchmarks must be based on real UK market data. " +
      "All recommendations must be specific and actionable.",
    parameters: {
      type: "object",
      properties: {
        displayName: {
          type: "string",
          description: "Human-readable name for this vertical. e.g. 'Personal Injury Law'",
        },
        avgTransactionValueGbp: {
          type: "number",
          description:
            "Average transaction/case value in GBP. " +
            "e.g. for personal injury law this might be £3,000-£15,000 — use the median.",
        },
        purchaseTimelineDays: {
          type: "integer",
          description:
            "Average number of days from first contact to purchase/booking. " +
            "e.g. aesthetics: 7, law: 30, HVAC repair: 1",
        },
        conversionGoalType: {
          type: "string",
          enum: ["formbooking", "phonecall", "walkin"],
          description:
            "Primary conversion goal. " +
            "'formbooking' = online booking form, 'phonecall' = phone enquiry, 'walkin' = in-person visit.",
        },
        cplBenchmarkGbp: {
          type: "number",
          description:
            "Target cost per lead in GBP based on UK Meta Ads market data. " +
            "This is the ceiling — campaigns above this need review.",
        },
        creativeStyle: {
          type: "string",
          description:
            "Specific creative direction for this vertical. " +
            "Include: visual style, tone, key emotions to trigger, what to show/avoid. " +
            "2-3 sentences. Be specific — not generic.",
        },
        audienceNotes: {
          type: "string",
          description:
            "Audience targeting notes specific to this vertical. " +
            "Include: age range, gender split, interests, behaviours, income indicators. " +
            "2-3 sentences.",
        },
        targetingRecommendations: {
          type: "string",
          description:
            "Specific Meta Ads targeting recommendations. " +
            "Include: interest categories, lookalike audiences, exclusions, geographic radius. " +
            "2-3 sentences.",
        },
        bidStrategyNotes: {
          type: "string",
          description:
            "Bid strategy recommendation for this vertical. " +
            "Include: starting bid cap, when to switch strategies, budget thresholds. " +
            "1-2 sentences.",
        },
        offerStructure: {
          type: "string",
          description:
            "What offer converts best for this vertical. " +
            "e.g. 'Free consultation', 'Free quote', 'Free assessment', 'No win no fee'. " +
            "Include why this offer works for this audience. 1-2 sentences.",
        },
        callScriptNotes: {
          type: "string",
          description:
            "Key notes for the AI call agent handling leads from this vertical. " +
            "Include: tone, key qualification questions, objections to handle, compliance notes. " +
            "2-3 sentences.",
        },
      },
      required: [
        "displayName",
        "avgTransactionValueGbp",
        "purchaseTimelineDays",
        "conversionGoalType",
        "cplBenchmarkGbp",
        "creativeStyle",
        "audienceNotes",
        "targetingRecommendations",
        "bidStrategyNotes",
        "offerStructure",
        "callScriptNotes",
      ],
      additionalProperties: false,
    },
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeneratedProfileData {
  displayName: string;
  avgTransactionValueGbp: number;
  purchaseTimelineDays: number;
  conversionGoalType: string;
  cplBenchmarkGbp: number;
  creativeStyle: string;
  audienceNotes: string;
  targetingRecommendations: string;
  bidStrategyNotes: string;
  offerStructure: string;
  callScriptNotes: string;
}

export interface PerformanceCampaignData {
  finalCpl: number;
  ctaRate: number;
  callToBookRate: number;
  creativeStyle: string;
}

// ── PerformanceDataStore ──────────────────────────────────────────────────────
// Shape of VerticalProfile.performanceData JSON field.
// campaigns array is capped at 500 entries (oldest dropped first).
export interface PerformanceDataStore {
  campaigns:   Record<string, unknown>[]; // AnonymisedCampaignResult[]
  lastUpdated: string;                    // ISO date string
  sampleSize:  number;                    // campaigns.length
}

// ── getVerticalProfile ────────────────────────────────────────────────────────

/**
 * Fetches a VerticalProfile from the DB by vertical key.
 * Returns null if not found — not an error.
 */
export async function getVerticalProfile(
  vertical: ServiceVertical | string
): Promise<VerticalProfile | null> {
  return prisma.verticalProfile.findUnique({
    where: { vertical: vertical as string },
  });
}

// ── generateVerticalProfile ───────────────────────────────────────────────────

/**
 * Uses GPT-4o to generate a complete VerticalProfile for an unseen vertical.
 * Saves the generated profile to DB and returns it.
 *
 * @param businessType - Free-text description e.g. "dental practice specialising in veneers"
 * @param vertical     - ServiceVertical enum value or GENERAL_[TYPE] string
 */
export async function generateVerticalProfile(
  businessType: string,
  vertical: ServiceVertical | string
): Promise<VerticalProfile> {
  const generated = await withRetry(
    async () => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are an expert media buyer with 15 years of performance marketing experience. " +
              "Generate a complete vertical intelligence profile for the following business type. " +
              "Base all CPL benchmarks on real UK market data. " +
              "All recommendations must be specific and actionable.",
          },
          {
            role: "user",
            content: `Business type: ${businessType}\nVertical key: ${vertical as string}`,
          },
        ],
        tools: [GENERATE_PROFILE_TOOL],
        tool_choice: {
          type: "function",
          function: { name: "create_vertical_profile" },
        },
        temperature: 0.3,
        max_tokens: 1200,
      });

      const rawToolCall = response.choices[0]?.message?.tool_calls?.[0];
      const toolCall = rawToolCall as ChatCompletionMessageFunctionToolCall | undefined;
      if (!toolCall?.function?.arguments) {
        throw new Error("generateVerticalProfile: No tool call returned from GPT-4o");
      }

      return JSON.parse(toolCall.function.arguments) as GeneratedProfileData;
    },
    { label: "verticalLibraryService.generateProfile", maxAttempts: 3, baseDelayMs: 500 }
  );

  // Compute USD benchmark
  const cplBenchmarkUsd = Math.round(generated.cplBenchmarkGbp * GBP_TO_USD_RATE * 100) / 100;

  // Upsert to DB (handles race conditions if called concurrently)
  const saved = await prisma.verticalProfile.upsert({
    where: { vertical: vertical as string },
    create: {
      vertical: vertical as string,
      displayName: generated.displayName,
      avgTransactionValueGbp: generated.avgTransactionValueGbp,
      purchaseTimelineDays: generated.purchaseTimelineDays,
      conversionGoalType: generated.conversionGoalType,
      cplBenchmarkGbp: generated.cplBenchmarkGbp,
      cplBenchmarkUsd,
      creativeStyle: generated.creativeStyle,
      audienceNotes: generated.audienceNotes,
      targetingRecommendations: generated.targetingRecommendations,
      bidStrategyNotes: generated.bidStrategyNotes,
      offerStructure: generated.offerStructure,
      callScriptNotes: generated.callScriptNotes,
      performanceData: {},
    },
    update: {
      displayName: generated.displayName,
      avgTransactionValueGbp: generated.avgTransactionValueGbp,
      purchaseTimelineDays: generated.purchaseTimelineDays,
      conversionGoalType: generated.conversionGoalType,
      cplBenchmarkGbp: generated.cplBenchmarkGbp,
      cplBenchmarkUsd,
      creativeStyle: generated.creativeStyle,
      audienceNotes: generated.audienceNotes,
      targetingRecommendations: generated.targetingRecommendations,
      bidStrategyNotes: generated.bidStrategyNotes,
      offerStructure: generated.offerStructure,
      callScriptNotes: generated.callScriptNotes,
    },
  });

  console.log(
    `[verticalLibraryService] Generated and saved profile: vertical=${vertical as string}, ` +
    `cplBenchmarkGbp=${generated.cplBenchmarkGbp}`
  );

  return saved;
}

// ── getOrGenerateVerticalProfile ──────────────────────────────────────────────

/**
 * Primary function for callers. Fetches from DB first; generates via GPT-4o if not found.
 * NEVER THROWS — returns a sensible fallback profile on error.
 *
 * @param vertical     - ServiceVertical enum value or GENERAL_[TYPE] string
 * @param businessType - Free-text description for GPT-4o generation if needed
 */
export async function getOrGenerateVerticalProfile(
  vertical: ServiceVertical | string,
  businessType: string
): Promise<VerticalProfile> {
  try {
    // ── 1. Try DB first ───────────────────────────────────────────────────────
    const existing = await getVerticalProfile(vertical);
    if (existing) return existing;

    // ── 2. Generate via GPT-4o ────────────────────────────────────────────────
    return await generateVerticalProfile(businessType, vertical);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[verticalLibraryService] getOrGenerateVerticalProfile error: ${message}`);

    // ── 3. Fallback profile — never throw ─────────────────────────────────────
    // Returns a generic profile so blueprint generation can continue.
    // The profile will be regenerated on the next request.
    return {
      id: "fallback",
      vertical: vertical as string,
      displayName: businessType,
      avgTransactionValueGbp: 500,
      purchaseTimelineDays: 14,
      conversionGoalType: "formbooking",
      cplBenchmarkGbp: 25,
      cplBenchmarkUsd: Math.round(25 * GBP_TO_USD_RATE * 100) / 100,
      creativeStyle:
        "Professional, trust-building, results-focused. Show real outcomes and social proof.",
      audienceNotes:
        "Adults 25-65. Target by interest and location. Exclude existing customers.",
      targetingRecommendations:
        "Start broad with location targeting. Use lookalike audiences from existing leads after 50+ conversions.",
      bidStrategyNotes:
        "Start with Lowest Cost. Switch to Cost Cap at £25 once 20+ leads collected.",
      offerStructure:
        "Free consultation or free assessment. Lowers barrier to entry and qualifies intent.",
      callScriptNotes:
        "Warm, professional tone. Qualify budget and timeline early. Book consultation before ending call.",
      performanceData: {},
      lastUpdated: new Date(),
    } as VerticalProfile;
  }
}

// ── updateVerticalPerformanceData ─────────────────────────────────────────────

/**
 * Appends a campaign result to the performanceData JSON column.
 * Used by the feedback loop in P2 Step 13.
 * Append-only — never overwrites existing data.
 *
 * @param vertical     - ServiceVertical enum value or GENERAL_[TYPE] string
 * @param campaignData - Campaign performance metrics to append
 */
export async function updateVerticalPerformanceData(
  vertical: ServiceVertical | string,
  result: Record<string, unknown>
): Promise<void> {
  try {
    const existing = await prisma.verticalProfile.findUnique({
      where:  { vertical: vertical as string },
      select: { performanceData: true },
    });

    if (!existing) {
      console.warn(
        `[verticalLibraryService] updateVerticalPerformanceData: ` +
        `No profile found for vertical=${vertical as string}. Skipping.`
      );
      return;
    }

    // Parse existing PerformanceDataStore
    const currentData = (existing.performanceData as Partial<PerformanceDataStore>) ?? {};
    const existingCampaigns: Record<string, unknown>[] =
      Array.isArray(currentData.campaigns) ? currentData.campaigns : [];

    // Append new result with recordedAt timestamp
    const newEntry: Record<string, unknown> = {
      ...result,
      recordedAt: new Date().toISOString(),
    };

    // Cap at 500 entries — drop oldest first
    const MAX_CAMPAIGNS = 500;
    const combined = [...existingCampaigns, newEntry];
    const updatedCampaigns = combined.length > MAX_CAMPAIGNS
      ? combined.slice(combined.length - MAX_CAMPAIGNS)
      : combined;

    const store: PerformanceDataStore = {
      campaigns:   updatedCampaigns,
      lastUpdated: new Date().toISOString(),
      sampleSize:  updatedCampaigns.length,
    };

    await prisma.verticalProfile.update({
      where: { vertical: vertical as string },
      data:  { performanceData: store as unknown as Prisma.InputJsonValue },
    });

    console.log(
      `[verticalLibraryService] Updated performance data for vertical=${vertical as string}: ` +
      `sampleSize=${store.sampleSize}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[verticalLibraryService] updateVerticalPerformanceData error: ${message}`
    );
    // Non-fatal — feedback loop failures must never break the main flow
  }
}
