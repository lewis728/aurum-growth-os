/**
 * src/lib/orchestrator/verticalMatcher.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Maps any plain English business description to the closest ServiceVertical enum value.
 * Uses GPT-4o-mini for speed and cost efficiency.
 *
 * Confidence threshold: 0.7
 * Below threshold → returns ServiceVertical.AESTHETICS_FILLER as safe default
 * (most common vertical in the Aurum client base).
 *
 * Wrapped in withRetry() for resilience.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import { ServiceVertical } from "@/enums/campaignEnums";
import { withRetry } from "@/lib/utils/withRetry";

// ── OpenAI Client ─────────────────────────────────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured. Set it in .env.local.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Tool Schema ───────────────────────────────────────────────────────────────

const VERTICAL_MATCH_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "match_vertical",
    description:
      "Map a business description to the closest service vertical category. " +
      "Return the exact enum value and a confidence score between 0 and 1.",
    parameters: {
      type: "object",
      properties: {
        vertical: {
          type: "string",
          enum: Object.values(ServiceVertical),
          description: "The closest matching ServiceVertical enum value",
        },
        confidence: {
          type: "number",
          description: "Confidence score from 0.0 to 1.0",
        },
        reasoning: {
          type: "string",
          description: "One sentence explaining the match",
        },
      },
      required: ["vertical", "confidence", "reasoning"],
      additionalProperties: false,
    },
  },
};

// ── Type ──────────────────────────────────────────────────────────────────────

interface VerticalMatchResult {
  vertical: string;
  confidence: number;
  reasoning: string;
}

// ── Confidence Threshold ──────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_VERTICAL = ServiceVertical.AESTHETICS_FILLER;

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Maps a plain English business description to the closest ServiceVertical.
 *
 * Examples:
 *   "dental practice in Manchester specialising in veneers" → DENTAL_WHITENING
 *   "aesthetics clinic offering anti-wrinkle injections"    → AESTHETICS_FILLER
 *   "baker in Birmingham selling sourdough"                 → DEFAULT (low confidence)
 *
 * @param businessType - Free-text business description from onboarding Q1
 * @returns The closest ServiceVertical enum value
 */
export async function matchVertical(businessType: string): Promise<ServiceVertical> {
  const systemPrompt =
    "You map business descriptions to the closest service vertical category. " +
    "Return only the exact enum value and a confidence score. " +
    "Be precise — only return high confidence if the match is clear. " +
    "Available verticals: " +
    Object.values(ServiceVertical).join(", ");

  const result = await withRetry(
    async () => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Business description: "${businessType}"\n\nMatch to the closest vertical.`,
          },
        ],
        tools: [VERTICAL_MATCH_TOOL],
        tool_choice: { type: "function", function: { name: "match_vertical" } },
        temperature: 0,
        max_tokens: 200,
      });

      const rawToolCall = response.choices[0]?.message?.tool_calls?.[0];
      const toolCall = rawToolCall as ChatCompletionMessageFunctionToolCall | undefined;
      if (!toolCall?.function?.arguments) {
        throw new Error("matchVertical: No tool call returned from GPT-4o-mini");
      }

      const parsed = JSON.parse(toolCall.function.arguments) as VerticalMatchResult;
      return parsed;
    },
    { label: "matchVertical", maxAttempts: 3, baseDelayMs: 500 }
  );

  // Validate the returned enum value
  const validVerticals = Object.values(ServiceVertical) as string[];
  if (!validVerticals.includes(result.vertical)) {
    console.warn(
      `[verticalMatcher] Unknown vertical "${result.vertical}" returned — using default`
    );
    return DEFAULT_VERTICAL;
  }

  // Apply confidence threshold
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    console.log(
      `[verticalMatcher] Low confidence (${result.confidence.toFixed(2)}) for ` +
      `"${businessType}" → "${result.vertical}" — using default. Reason: ${result.reasoning}`
    );
    return DEFAULT_VERTICAL;
  }

  console.log(
    `[verticalMatcher] Matched "${businessType}" → "${result.vertical}" ` +
    `(confidence: ${result.confidence.toFixed(2)})`
  );

  return result.vertical as ServiceVertical;
}
