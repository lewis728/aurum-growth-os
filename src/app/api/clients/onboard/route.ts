/**
 * src/app/api/clients/onboard/route.ts
 * POST /api/clients/onboard
 * SERVER-SIDE ONLY.
 *
 * SSE streaming route that drives the five-question Add Client conversation.
 * The caller is the AGENCY OWNER adding a NEW CLIENT to their Aurum workspace.
 *
 * These questions are about the CLIENT's business — not the agency owner's.
 *
 * SSE event types:
 *   { type: "text", content: string }
 *   { type: "question_number", number: number }
 *   { type: "client_added", blueprintId: string, businessName: string }
 *   { type: "error", message: string }
 *   { type: "done" }
 *
 * On completion: creates a CampaignBlueprint row for the client.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ── Questions ─────────────────────────────────────────────────────────────────

const CLIENT_QUESTIONS = [
  "Let's add your client. What's the name of their business and what do they do?",
  "What's their monthly ad budget? Even a rough range is fine — e.g. £500–£1,000/month.",
  "Who is their ideal lead? Describe the type of person or business they want to attract.",
  "What outcome does the client want from their campaigns — more bookings, enquiries, calls, or something else?",
  "What's their main offer or hook? What makes them stand out from competitors?",
] as const;

const TOTAL_QUESTIONS = CLIENT_QUESTIONS.length; // 5

const SYSTEM_PROMPT =
  "You are the Aurum client onboarding assistant. You are helping a marketing agency owner add a new client to their Aurum Growth OS workspace. " +
  "Your job is to ask exactly 5 questions about the CLIENT's business, in order. Be warm, direct, and professional. " +
  "Keep responses short — 1-2 sentences max after each answer before asking the next question. " +
  "Never ask more than one question at a time.";

// ── Request Schema ────────────────────────────────────────────────────────────

const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string(),
});

const RequestBodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(ChatMessageSchema).max(20),
});

// ── SSE Helper ────────────────────────────────────────────────────────────────

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function* streamText(
  text: string,
  encoder: TextEncoder
): AsyncGenerator<Uint8Array> {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = i === 0 ? words[i]! : " " + words[i]!;
    yield encoder.encode(sseEvent({ type: "text", content: chunk }));
    await new Promise((r) => setTimeout(r, 30));
  }
}

// ── Client Profile Extraction ─────────────────────────────────────────────────

interface ClientProfile {
  businessName: string;
  businessDescription: string;
  monthlyAdBudget: string;
  idealLead: string;
  desiredOutcome: string;
  offerHook: string;
}

async function extractClientProfile(
  messages: z.infer<typeof ChatMessageSchema>[]
): Promise<ClientProfile> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "Extract a structured client profile from this onboarding conversation. " +
          "The agency owner is describing their client's business. " +
          "Return JSON with: businessName, businessDescription, monthlyAdBudget, idealLead, desiredOutcome, offerHook. " +
          "Never leave fields empty — infer from context if needed.",
      },
      ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 400,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<ClientProfile>;

  return {
    businessName: parsed.businessName?.trim() || "New Client",
    businessDescription: parsed.businessDescription?.trim() || "",
    monthlyAdBudget: parsed.monthlyAdBudget?.trim() || "Not specified",
    idealLead: parsed.idealLead?.trim() || "Not specified",
    desiredOutcome: parsed.desiredOutcome?.trim() || "Not specified",
    offerHook: parsed.offerHook?.trim() || "Not specified",
  };
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId;

  let body: z.infer<typeof RequestBodySchema>;
  try {
    body = RequestBodySchema.parse((await req.json()) as unknown);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { message, history } = body;

  const newUserMessage = {
    id: `user-${Date.now()}`,
    role: "user" as const,
    content: message,
    timestamp: new Date().toISOString(),
  };

  const fullHistory = [...history, newUserMessage];
  const userAnswerCount = fullHistory.filter((m) => m.role === "user").length;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── All 5 questions answered — extract and save ───────────────────────
        if (userAnswerCount >= TOTAL_QUESTIONS) {
          const profile = await extractClientProfile(fullHistory);

          // Create a CampaignBlueprint for this client
          const blueprint = await prisma.campaignBlueprint.create({
            data: {
              tenantId,
              status: "DRAFT",
              vertical: "GENERAL",
              businessName: profile.businessName,
              targetLocation: "UK",
              dailyBudgetUsd: 50,
              creative: {},
              mediaBuying: {},
              deployment: {},
              voice: {},
              crm: {},
              businessDescription: profile.businessDescription,
              monthlyAdBudget: profile.monthlyAdBudget,
              idealLead: profile.idealLead,
              desiredOutcome: profile.desiredOutcome,
              offerHook: profile.offerHook,
            },
          });

          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "client_added",
                blueprintId: blueprint.id,
                businessName: profile.businessName,
              })
            )
          );
          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
          return;
        }

        // ── Next question ─────────────────────────────────────────────────────
        const nextIndex = userAnswerCount;
        const nextQuestion = CLIENT_QUESTIONS[nextIndex]!;

        if (userAnswerCount > 0) {
          // Generate acknowledgement + next question via LLM
          const llmMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: "system", content: SYSTEM_PROMPT },
            ...fullHistory.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            {
              role: "user" as const,
              content: `[SYSTEM: Acknowledge the answer in 1 sentence, then ask: "${nextQuestion}"]`,
            },
          ];

          const llmResponse = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: llmMessages,
            temperature: 0.7,
            max_tokens: 150,
          });

          const responseText =
            llmResponse.choices[0]?.message?.content ?? nextQuestion;

          controller.enqueue(
            encoder.encode(
              sseEvent({ type: "question_number", number: nextIndex + 1 })
            )
          );

          for await (const chunk of streamText(responseText, encoder)) {
            controller.enqueue(chunk);
          }
        } else {
          controller.enqueue(
            encoder.encode(sseEvent({ type: "question_number", number: 1 }))
          );
          for await (const chunk of streamText(nextQuestion, encoder)) {
            controller.enqueue(chunk);
          }
        }

        controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unexpected error";
        console.error("[clients/onboard]", msg);
        try {
          controller.enqueue(encoder.encode(sseEvent({ type: "error", message: msg })));
          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
