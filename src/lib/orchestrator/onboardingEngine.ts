/**
 * src/lib/orchestrator/onboardingEngine.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Drives the five-question onboarding conversation for agency owners setting up
 * THEIR OWN AGENCY on Aurum Growth OS.
 *
 * IMPORTANT: These questions are about the AGENCY OWNER's business, not any client.
 * Client campaigns are set up separately via the Add Client flow.
 *
 * Flow:
 *   Q1 (agency_name) → Q2 (niches) → Q3 (client_count) → Q4 (fulfilment) → Q5 (goal)
 *   → extract_agency_profile() → return AgencyProfileData
 *
 * The engine is stateless — it receives the full message history on each call
 * and determines which question to ask next based on how many user answers exist.
 *
 * GOLDEN RULES:
 *   1. runOnboardingConversation() NEVER THROWS. Returns error state gracefully.
 *   2. All GPT calls are wrapped in withRetry().
 *   3. Profile extraction happens only after Q5 is answered.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";
import { withRetry } from "@/lib/utils/withRetry";
import type { ChatMessage } from "@/lib/orchestrator/intentProcessor";

// ── OpenAI Client ─────────────────────────────────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not configured. Set it in .env.local.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Onboarding Questions (Agency Owner) ───────────────────────────────────────

/**
 * Five questions about the AGENCY OWNER's business.
 * These are asked once at signup — not about any specific client.
 */
export const ONBOARDING_QUESTIONS: readonly string[] = [
  "Let's get your agency set up. What's the name of your agency?",
  "What types of businesses do you typically work with? For example: trades, healthcare, legal, fitness, e-commerce — whatever your sweet spot is.",
  "How many clients are you currently managing or fulfilling for?",
  "How are you currently fulfilling for clients — doing it yourself, using a team, white-labelling, or something else?",
  "Last one — what's the main thing you want Aurum to help you with? More clients, better results for existing ones, less manual work, or something else?",
] as const;

export const TOTAL_QUESTIONS = ONBOARDING_QUESTIONS.length; // 5

// ── Welcome Message ───────────────────────────────────────────────────────────

export const WELCOME_MESSAGE =
  "Let's personalise your Aurum OS. Five quick questions about your agency and you're in.";

// ── System Prompt ─────────────────────────────────────────────────────────────

const ONBOARDING_SYSTEM_PROMPT =
  "You are the Aurum onboarding assistant. You are setting up a marketing agency owner's workspace on Aurum Growth OS — an autonomous AI fulfilment platform. " +
  "Your job is to ask exactly 5 questions about their agency, in order. Be warm, direct, and professional. Keep responses short — 1-2 sentences max after each answer before asking the next question. " +
  "Never ask more than one question at a time. Never ask about any specific client campaign — that happens separately in the 'Add Client' flow. " +
  "After question 5, confirm you're setting up their workspace and end the conversation. Do not improvise additional questions.";

// ── Extracted Agency Profile ──────────────────────────────────────────────────

export interface AgencyProfileData {
  agencyName: string;
  niches: string;
  currentClientCount: string;
  currentFulfilment: string;
  primaryGoal: string;
}

// ── Result Type ───────────────────────────────────────────────────────────────

export interface OnboardingResult {
  nextQuestion: string | null;
  questionNumber: number | null;
  agencyProfile: AgencyProfileData | null;
  isComplete: boolean;
  error?: string;
}

// ── Tool Schema — extract_agency_profile ─────────────────────────────────────

const EXTRACT_PROFILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_agency_profile",
    description:
      "Extract a structured agency profile from the onboarding conversation. " +
      "Called after all five questions have been answered. " +
      "The person answering is a marketing agency owner describing their own business.",
    parameters: {
      type: "object",
      properties: {
        agencyName: {
          type: "string",
          description: "The name of the marketing agency. Taken from Q1.",
        },
        niches: {
          type: "string",
          description:
            "The types of businesses the agency works with. Taken from Q2. " +
            "e.g. 'aesthetics clinics, dental practices, hair transplant clinics'",
        },
        currentClientCount: {
          type: "string",
          description:
            "How many clients the agency currently manages. Taken from Q3. " +
            "Store as a string — could be '0', '3', '10+', etc.",
        },
        currentFulfilment: {
          type: "string",
          description:
            "How the agency currently fulfils for clients. Taken from Q4. " +
            "e.g. 'doing it myself', 'small team of 3', 'white-labelling'",
        },
        primaryGoal: {
          type: "string",
          description:
            "The main thing the agency owner wants Aurum to help with. Taken from Q5. " +
            "e.g. 'more clients', 'better results for existing clients', 'less manual work'",
        },
      },
      required: [
        "agencyName",
        "niches",
        "currentClientCount",
        "currentFulfilment",
        "primaryGoal",
      ],
      additionalProperties: false,
    },
  },
};

// ── Helper ────────────────────────────────────────────────────────────────────

function countUserAnswers(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Drives the onboarding conversation for an agency owner setting up their workspace.
 *
 * Stateless — receives full message history on each call.
 *
 * @param _tenantId - Unused; kept for API compatibility. May be null during onboarding.
 * @param messages  - Full conversation history (ChatMessage[])
 * @returns OnboardingResult with nextQuestion or completed agencyProfile
 */
export async function runOnboardingConversation(
  _tenantId: string,
  messages: ChatMessage[]
): Promise<OnboardingResult> {
  try {
    const userAnswerCount = countUserAnswers(messages);

    // ── Not yet answered all 5 questions ─────────────────────────────────────
    if (userAnswerCount < TOTAL_QUESTIONS) {
      const nextIndex = userAnswerCount; // 0-indexed
      const nextQuestion = ONBOARDING_QUESTIONS[nextIndex];

      if (!nextQuestion) {
        return {
          nextQuestion: null,
          questionNumber: null,
          agencyProfile: null,
          isComplete: false,
          error: "Question index out of bounds",
        };
      }

      // For Q2+, generate a warm acknowledgement + next question via LLM
      if (userAnswerCount > 0) {
        const conversationMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
          [
            { role: "system", content: ONBOARDING_SYSTEM_PROMPT },
            ...messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            {
              role: "user" as const,
              content: `[SYSTEM: The user just answered Q${userAnswerCount}. Acknowledge their answer in 1 sentence, then ask Q${nextIndex + 1}: "${nextQuestion}"]`,
            },
          ];

        const response = await withRetry(
          async () => {
            const r = await openai.chat.completions.create({
              model: "gpt-4o",
              messages: conversationMessages,
              temperature: 0.7,
              max_tokens: 150,
            });
            return r.choices[0]?.message?.content ?? nextQuestion;
          },
          { label: "onboardingEngine.followUp", maxAttempts: 2, baseDelayMs: 300 }
        );

        return {
          nextQuestion: response,
          questionNumber: nextIndex + 1,
          agencyProfile: null,
          isComplete: false,
        };
      }

      return {
        nextQuestion,
        questionNumber: nextIndex + 1,
        agencyProfile: null,
        isComplete: false,
      };
    }

    // ── All 5 questions answered — extract agency profile via GPT-4o ──────────

    const systemPrompt =
      "You are an expert at extracting structured agency profiles from conversations. " +
      "The conversation is between an AI assistant and a marketing agency owner who is " +
      "setting up their workspace. The agency owner is answering questions about their own agency. " +
      "Extract the agency profile accurately from the conversation history. " +
      "Be generous with inference — never leave required fields empty.";

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
            function: { name: "extract_agency_profile" },
          },
          temperature: 0,
          max_tokens: 400,
        });

        const rawToolCall = response.choices[0]?.message?.tool_calls?.[0];
        const toolCall = rawToolCall as
          | ChatCompletionMessageFunctionToolCall
          | undefined;
        if (!toolCall?.function?.arguments) {
          throw new Error(
            "onboardingEngine: No tool call returned from GPT-4o extraction"
          );
        }

        return JSON.parse(toolCall.function.arguments) as AgencyProfileData;
      },
      { label: "onboardingEngine.extractProfile", maxAttempts: 3, baseDelayMs: 500 }
    );

    // Ensure required fields have fallback values
    if (!extractedProfile.agencyName?.trim()) extractedProfile.agencyName = "My Agency";
    if (!extractedProfile.niches?.trim()) extractedProfile.niches = "General";
    if (!extractedProfile.currentClientCount?.trim()) extractedProfile.currentClientCount = "0";
    if (!extractedProfile.currentFulfilment?.trim()) extractedProfile.currentFulfilment = "Not specified";
    if (!extractedProfile.primaryGoal?.trim()) extractedProfile.primaryGoal = "Grow the agency";

    return {
      nextQuestion: null,
      questionNumber: null,
      agencyProfile: extractedProfile,
      isComplete: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[onboardingEngine] Error:", message);

    return {
      nextQuestion: null,
      questionNumber: null,
      agencyProfile: null,
      isComplete: false,
      error: message,
    };
  }
}
