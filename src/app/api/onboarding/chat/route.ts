/**
 * src/app/api/onboarding/chat/route.ts
 * POST /api/onboarding/chat
 * SERVER-SIDE ONLY.
 *
 * SSE streaming route that drives the five-question agency onboarding conversation.
 * The caller is the AGENCY OWNER setting up their own workspace — NOT a client campaign.
 *
 * SSE event types:
 *   { type: "text", content: string }              — next question text (streamed word by word)
 *   { type: "question_number", number: number }    — current question index (1–5)
 *   { type: "onboarding_complete", agencyName: string } — profile saved, redirect
 *   { type: "error", message: string }             — non-fatal error
 *   { type: "done" }                               — stream end sentinel
 *
 * On completion: saves AgencyProfile to DB, emits onboarding_complete.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import {
  runOnboardingConversation,
  WELCOME_MESSAGE,
} from "@/lib/orchestrator/onboardingEngine";
import type { ChatMessage } from "@/lib/orchestrator/intentProcessor";

export const dynamic = "force-dynamic";

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
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  // Only userId is required — orgId may still be propagating after setActive()
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? null;

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: z.infer<typeof RequestBodySchema>;
  try {
    const raw = (await req.json()) as unknown;
    body = RequestBodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { message, history } = body;

  const newUserMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  };

  const fullHistory: ChatMessage[] = [...history, newUserMessage];

  // ── 3. Stream SSE response ────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Pass userId as fallback tenantId — engine ignores it but needs a string
        const result = await runOnboardingConversation(tenantId ?? userId, fullHistory);

        if (result.error) {
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "error",
                message: "Something went wrong. Please try again.",
              })
            )
          );
          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
          return;
        }

        // ── Onboarding complete — save AgencyProfile to DB ──────────────────
        if (result.isComplete && result.agencyProfile) {
          const profile = result.agencyProfile;

          // Determine the tenantId to save against
          // If orgId is null (JWT still propagating), save with pendingOrgLink=true
          // and use userId as a temporary key. The /api/auth/link-org route will
          // fix this up once the org is confirmed.
          const effectiveTenantId = tenantId ?? `pending:${userId}`;
          const isPending = !tenantId;

          try {
            // Upsert AgencyProfile — idempotent if called twice
            await prisma.agencyProfile.upsert({
              where: { tenantId: effectiveTenantId },
              create: {
                tenantId: effectiveTenantId,
                agencyName: profile.agencyName,
                niches: profile.niches,
                currentClientCount: profile.currentClientCount,
                currentFulfilment: profile.currentFulfilment,
                primaryGoal: profile.primaryGoal,
              },
              update: {
                agencyName: profile.agencyName,
                niches: profile.niches,
                currentClientCount: profile.currentClientCount,
                currentFulfilment: profile.currentFulfilment,
                primaryGoal: profile.primaryGoal,
              },
            });

            if (isPending) {
              console.warn(
                `[onboarding/chat] AgencyProfile saved with pending tenantId=${effectiveTenantId} — will be linked when org propagates`
              );
            }
          } catch (dbErr) {
            const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
            console.error("[onboarding/chat] Failed to save AgencyProfile:", dbMsg);
            // Non-fatal — still emit complete so user can proceed
          }

          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "onboarding_complete",
                agencyName: profile.agencyName,
              })
            )
          );

          controller.enqueue(encoder.encode(sseEvent({ type: "done" })));
          controller.close();
          return;
        }

        // ── Next question ───────────────────────────────────────────────────
        if (result.nextQuestion && result.questionNumber !== null) {
          controller.enqueue(
            encoder.encode(
              sseEvent({
                type: "question_number",
                number: result.questionNumber,
              })
            )
          );

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

export async function GET(): Promise<NextResponse> {
  try {
    await auth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    welcomeMessage: WELCOME_MESSAGE,
    totalQuestions: 5,
    firstQuestion: WELCOME_MESSAGE,
  });
}
