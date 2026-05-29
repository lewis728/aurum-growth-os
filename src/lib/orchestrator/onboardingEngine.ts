/**
 * src/lib/orchestrator/onboardingEngine.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Drives the five-question onboarding conversation for agency owners setting up
 * a new client campaign. Uses GPT-4o with forced tool call to extract a
 * structured BusinessProfile from the conversation history.
 *
 * IMPORTANT CONTEXT: The person using this is a marketing agency owner.
 * They are configuring a campaign on behalf of their client.
 * All questions and copy must reflect this — "your client's business", not "your business".
 *
 * Flow:
 *   Q1 → Q2 → Q3 → Q4 → Q5 → extract_business_profile() → generateBlueprintFromProfile()
 *
 * The engine is stateless — it receives the full message history on each call
 * and determines which question to ask next based on how many user answers exist.
 *
 * GOLDEN RULES:
 *   1. runOnboardingConversation() NEVER THROWS. Returns error state gracefully.
 *   2. All GPT calls are wrapped in withRetry().
 *   3. Blueprint generation happens only after Q5 is answered.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import { withRetry } from "@/lib/utils/withRetry";
import { generateBlueprintFromProfile } from "@/lib/orchestrator/blueprintGenerator";
import type { BusinessProfile } from "@/lib/orchestrator/blueprintGenerator";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";
import type { ChatMessage } from "@/lib/orchestrator/intentProcessor";

// ── OpenAI Client ─────────────────────────────────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured. Set it in .env.local.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Onboarding Questions (Agency-Owner Copy) ──────────────────────────────────

/**
 * The five questions asked in sequence.
 * Copy is framed for agency owners configuring a campaign for their client.
 * The person answering is NOT the business owner — they are the agency owner.
 */
export const ONBOARDING_QUESTIONS: readonly string[] = [
  "Tell me about your client's business — what do they do and who do they help?",
  "Perfect. When a new customer comes to your client, how does that usually happen — do they walk in, call, or book online?",
  "What makes your client different from their competitors? Give me their best one-liner.",
  "What would you like your client's AI representative to be called? This is the name their leads will hear on the phone.",
  "Last question — what daily advertising budget is your client starting with? We recommend at least £30/day for meaningful results.",
] as const;

export const TOTAL_QUESTIONS = ONBOARDING_QUESTIONS.length; // 5

// ── Welcome Message ───────────────────────────────────────────────────────────

export const WELCOME_MESSAGE =
  "Let's set up your next client campaign. I'll ask you five quick questions and have everything ready to launch.";

// ── Tool Schema — extract_business_profile ────────────────────────────────────

const EXTRACT_PROFILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_business_profile",
    description:
      "Extract a structured business profile from the onboarding conversation. " +
      "Called after all five questions have been answered. " +
      "The agency owner is configuring this on behalf of their client.",
    parameters: {
      type: "object",
      properties: {
        businessName: {
          type: "string",
          description:
            "The client's business name. Infer from Q1 if explicitly stated, " +
            "otherwise use a descriptive placeholder like 'Manchester Dental Practice'.",
        },
        businessType: {
          type: "string",
          description:
            "Free-text description of the client's business type and location. " +
            "e.g. 'dental practice in Manchester specialising in veneers'",
        },
        targetCustomer: {
          type: "string",
          description:
            "Who the client's ideal customer is, inferred from Q1 and Q2. " +
            "e.g. 'adults 25-55 in Manchester looking for cosmetic dentistry'",
        },
        uniqueSellingPoint: {
          type: "string",
          description:
            "The client's best one-liner differentiator from Q3. " +
            "Use verbatim if concise, or clean up lightly.",
        },
        conversionGoal: {
          type: "string",
          enum: ["walkin", "phonecall", "formbooking"],
          description:
            "How new customers typically convert, from Q2. " +
            "'walkin' = walk-in / in-person, 'phonecall' = phone call, " +
            "'formbooking' = online booking / form submission.",
        },
        repName: {
          type: "string",
          description:
            "The name the AI representative will use on calls, from Q4. " +
            "e.g. 'Sophie', 'James', 'Alex'",
        },
        dailyBudgetGbp: {
          type: "number",
          description:
            "Daily advertising budget in GBP, from Q5. " +
            "Extract the numeric value only. If a range is given, use the lower bound. " +
            "Minimum 10. Default to 30 if unclear.",
        },
        geography: {
          type: "string",
          description:
            "Geographic targeting area, inferred from Q1 or Q2. " +
            "e.g. 'Manchester', 'London', 'Birmingham', 'UK'. " +
            "Default to 'UK' if not specified.",
        },
      },
      required: [
        "businessName",
        "businessType",
        "targetCustomer",
        "uniqueSellingPoint",
        "conversionGoal",
        "repName",
        "dailyBudgetGbp",
        "geography",
      ],
      additionalProperties: false,
    },
  },
};

// ── Return Type ───────────────────────────────────────────────────────────────

export interface OnboardingResult {
  /** The next question to ask, or null if onboarding is complete */
  nextQuestion: string | null;
  /** 1-indexed question number (1–5), or null if complete */
  questionNumber: number | null;
  /** Partial blueprint, populated only when isComplete is true */
  blueprint: Partial<CampaignBlueprint> | null;
  /** True when all 5 questions have been answered and blueprint is generated */
  isComplete: boolean;
  /** Error message if extraction failed */
  error?: string;
}

// ── Helper: count user answers ────────────────────────────────────────────────

/**
 * Counts how many user messages exist in the conversation.
 * The welcome message is an assistant message, so user messages start from Q1.
 */
function countUserAnswers(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Drives the onboarding conversation for an agency owner setting up a client campaign.
 *
 * Stateless — receives full message history on each call.
 *
 * @param tenantId - Clerk organisation ID of the agency owner
 * @param messages - Full conversation history (ChatMessage[])
 * @returns OnboardingResult with nextQuestion or completed blueprint
 */
export async function runOnboardingConversation(
  tenantId: string,
  messages: ChatMessage[]
): Promise<OnboardingResult> {
  try {
    const userAnswerCount = countUserAnswers(messages);

    // ── Not yet answered all 5 questions ─────────────────────────────────────
    if (userAnswerCount < TOTAL_QUESTIONS) {
      const nextIndex = userAnswerCount; // 0-indexed
      const nextQuestion = ONBOARDING_QUESTIONS[nextIndex];

      if (!nextQuestion) {
        // Should never happen — guard against index out of bounds
        return {
          nextQuestion: null,
          questionNumber: null,
          blueprint: null,
          isComplete: false,
          error: "Question index out of bounds",
        };
      }

      return {
        nextQuestion,
        questionNumber: nextIndex + 1,
        blueprint: null,
        isComplete: false,
      };
    }

    // ── All 5 questions answered — extract profile via GPT-4o ─────────────────

    // Build conversation for GPT-4o (system + all messages)
    const systemPrompt =
      "You are an expert at extracting structured business profiles from conversations. " +
      "The conversation is between an AI assistant and a marketing agency owner who is " +
      "setting up a new client campaign. The agency owner is answering questions about " +
      "their client's business — NOT their own business. " +
      "Extract the business profile accurately from the conversation history. " +
      "Be generous with inference — if a field is not explicitly stated, make a reasonable " +
      "inference from context. Never leave required fields empty.";

    const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const extractedProfile = await withRetry(
      async () => {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: conversationMessages,
          tools: [EXTRACT_PROFILE_TOOL],
          tool_choice: {
            type: "function",
            function: { name: "extract_business_profile" },
          },
          temperature: 0,
          max_tokens: 800,
        });

        const rawToolCall = response.choices[0]?.message?.tool_calls?.[0];
        const toolCall = rawToolCall as ChatCompletionMessageFunctionToolCall | undefined;
        if (!toolCall?.function?.arguments) {
          throw new Error(
            "onboardingEngine: No tool call returned from GPT-4o extraction"
          );
        }

        return JSON.parse(toolCall.function.arguments) as BusinessProfile;
      },
      { label: "onboardingEngine.extractProfile", maxAttempts: 3, baseDelayMs: 500 }
    );

    // ── Validate extracted profile ────────────────────────────────────────────

    // Clamp budget to minimum £10
    if (extractedProfile.dailyBudgetGbp < 10) {
      extractedProfile.dailyBudgetGbp = 10;
    }

    // Ensure geography has a value
    if (!extractedProfile.geography || extractedProfile.geography.trim() === "") {
      extractedProfile.geography = "UK";
    }

    // Ensure repName has a value
    if (!extractedProfile.repName || extractedProfile.repName.trim() === "") {
      extractedProfile.repName = "Alex";
    }

    // ── Generate blueprint ────────────────────────────────────────────────────

    const blueprint = await generateBlueprintFromProfile(extractedProfile, tenantId);

    return {
      nextQuestion: null,
      questionNumber: null,
      blueprint,
      isComplete: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[onboardingEngine] Error:", message);

    return {
      nextQuestion: null,
      questionNumber: null,
      blueprint: null,
      isComplete: false,
      error: message,
    };
  }
}
