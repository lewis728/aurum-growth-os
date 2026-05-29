/**
 * src/app/api/onboarding/chat/route.ts
 * POST /api/onboarding/chat
 * SERVER-SIDE ONLY.
 *
 * SSE streaming route that drives the five-question onboarding conversation.
 * The caller is a marketing agency owner setting up a campaign for their client.
 *
 * SSE event types:
 *   { type: "text", content: string }              — next question text (streamed char by char)
 *   { type: "question_number", number: number }    — current question index (1–5)
 *   { type: "onboarding_complete", blueprintId: string } — blueprint saved, redirect
 *   { type: "error", message: string }             — non-fatal error
 *   { type: "done" }                               — stream end sentinel
 *
 * On completion: saves generated blueprint to DB with status DRAFT, emits blueprintId.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addClientSeat } from "@/lib/services/stripeService";
import { canLaunchCampaign } from "@/lib/access/subscriptionGuard";
import {
  runOnboardingConversation,
  WELCOME_MESSAGE,
} from "@/lib/orchestrator/onboardingEngine";
import { CampaignStatus } from "@/enums/campaignEnums";
import type { ChatMessage } from "@/lib/orchestrator/intentProcessor";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { CreativeLayer } from "@/types/creativeLayer";
import type { MediaBuyingLayer } from "@/types/mediaBuyingLayer";
import type { DeploymentLayer } from "@/types/deploymentLayer";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { VoiceLayer } from "@/types/voiceLayer";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { CRMLayer } from "@/types/crmLayer";

// ── Request Schema ────────────────────────────────────────────────────────────

const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string(),
});

const RequestBodySchema = z.object({
  /** The latest user message */
  message: z.string().min(1).max(2000),
  /** Full conversation history including the latest message */
  history: z.array(ChatMessageSchema).max(20),
});

// ── SSE Helper ────────────────────────────────────────────────────────────────

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Simulates streaming by emitting text character by character with a small delay.
 * This gives the UI a typewriter effect consistent with the Command Center chat.
 */
async function* streamText(
  text: string,
  encoder: TextEncoder
): AsyncGenerator<Uint8Array> {
  // Emit in small chunks (words) rather than individual chars for performance
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = i === 0 ? words[i]! : " " + words[i]!;
    yield encoder.encode(sseEvent({ type: "text", content: chunk }));
    // Small delay between words for natural feel
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Subscription access check ─────────────────────────────────────────
  const access = await canLaunchCampaign(tenantId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }


  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: z.infer<typeof RequestBodySchema>;
  try {
    const raw = (await req.json()) as unknown;
    body = RequestBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { message, history } = body;

  // ── 3. Build full message history including the new user message ──────────
  const newUserMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  };

  const fullHistory: ChatMessage[] = [...history, newUserMessage];

  // ── 4. Stream SSE response ────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── Run onboarding engine ───────────────────────────────────────────
        const result = await runOnboardingConversation(tenantId, fullHistory);

        if (result.error) {
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "error",
                message:
                  "Something went wrong processing your answer. Please try again.",
              })
            )
          );
          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
          return;
        }

        // ── Onboarding complete — save blueprint to DB ──────────────────────
        if (result.isComplete && result.blueprint) {
          const bp = result.blueprint;

          // Persist to DB with status DRAFT
          const saved = await prisma.campaignBlueprint.create({
            data: {
              tenantId,
              status: CampaignStatus.PENDING,
              vertical: bp.serviceIntent ?? "",
              businessName:
                (bp.deploymentLayer as DeploymentLayer | undefined)?.copy
                  ?.heroHeadline ?? "New Client",
              targetLocation:
                (bp.mediaBuyingLayer as MediaBuyingLayer | undefined)?.targeting
                  ?.geoLocations?.countries?.[0] ?? "UK",
              dailyBudgetUsd: bp.budget?.dailyUsd ?? 30,
              creative: (bp.creativeLayer ?? {}) as object,
              mediaBuying: (bp.mediaBuyingLayer ?? {}) as object,
              deployment: (bp.deploymentLayer ?? {}) as object,
              voice: (bp.voiceLayer ?? {}) as object,
              crm: (bp.crmLayer ?? {}) as object,
              orchestrationLog: [],
            },
          });

          // Add a client seat to the Stripe subscription (non-fatal)
          setImmediate(() => {
            addClientSeat(tenantId).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(`[onboarding/chat] addClientSeat failed for tenantId=${tenantId}: ${msg}`);
            });
          });

          // Emit completion event
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "onboarding_complete",
                blueprintId: saved.id,
              })
            )
          );

          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
          return;
        }

        // ── Next question to ask ────────────────────────────────────────────
        if (result.nextQuestion && result.questionNumber !== null) {
          // Emit question number first so UI can update progress indicator
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "question_number",
                number: result.questionNumber,
              })
            )
          );

          // Stream the question text word by word
          for await (const chunk of streamText(result.nextQuestion, encoder)) {
            controller.enqueue(chunk);
          }
        }

        controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        console.error("[onboarding/chat] Stream error:", message);

        try {
          controller.enqueue(
            encoder.encode(sseEvent({ type: "error", message }))
          );
          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
        } catch {
          // Controller already closed
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

// ── GET — returns the welcome message and initial state ───────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> { // eslint-disable-line @typescript-eslint/no-unused-vars
  // Auth check
  try {
    await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    welcomeMessage: WELCOME_MESSAGE,
    totalQuestions: 5,
    firstQuestion:
      "Tell me about your client's business — what do they do and who do they help?",
  });
}
