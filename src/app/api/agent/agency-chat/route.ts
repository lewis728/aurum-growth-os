/**
 * POST /api/agent/agency-chat
 *
 * Agency-level chief-of-staff chat. Has visibility across ALL blueprints
 * for this tenant — leads, appointments, agent actions taken in last 24h.
 * Streams SSE response tokens.
 *
 * Never returns a non-streaming error to the client — all failures degrade
 * gracefully to a streamed fallback message.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function streamFallback(message: string): Response {
  const enc = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ text: message })}\n\n`));
      controller.enqueue(enc.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const tenantId = orgId ?? `pending:${userId}`;

  // ── OpenAI key check — stream fallback instead of JSON error ─────────────
  if (!process.env.OPENAI_API_KEY) {
    console.error("[agency-chat] OPENAI_API_KEY is not set");
    return streamFallback("I'm still getting set up. Check back shortly.");
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let message: string;
  try {
    const body = (await req.json()) as { message?: string };
    message = body.message?.trim() ?? "";
  } catch (err) {
    console.error("[agency-chat] Failed to parse request body:", err);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // ── Fetch agency-wide context ─────────────────────────────────────────────
  let blueprints: Awaited<ReturnType<typeof prisma.campaignBlueprint.findMany<{
    where: { tenantId: string };
    select: { id: true; businessName: true; vertical: true; status: true; dailyBudgetUsd: true; _count: { select: { leads: true; appointments: true } } };
  }>>>;
  let recentActions: Awaited<ReturnType<typeof prisma.agentAction.findMany>>;

  try {
    [blueprints, recentActions] = await Promise.all([
      prisma.campaignBlueprint.findMany({
        where:   { tenantId },
        select: {
          id:             true,
          businessName:   true,
          vertical:       true,
          status:         true,
          dailyBudgetUsd: true,
          _count:         { select: { leads: true, appointments: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.agentAction.findMany({
        where: {
          tenantId,
          executedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { executedAt: "desc" },
        take:    25,
      }),
    ]);
  } catch (err) {
    console.error("[agency-chat] DB fetch failed:", err);
    return streamFallback("I'm having trouble reading your account data right now. Try again in a moment.");
  }

  // ── Build context strings ────────────────────────────────────────────────
  const totalLeads        = blueprints.reduce((s, b) => s + b._count.leads, 0);
  const totalAppointments = blueprints.reduce((s, b) => s + b._count.appointments, 0);

  const clientsSummary = blueprints.length === 0
    ? "No clients added yet."
    : blueprints
        .map(b =>
          `  • ${b.businessName} (${b.vertical}): status=${b.status}, ` +
          `budget=£${b.dailyBudgetUsd}/day, leads=${b._count.leads}, appts=${b._count.appointments}`
        )
        .join("\n");

  // Client-name lookup for action attribution (blueprintId may be null = portfolio).
  const clientNameById = new Map(blueprints.map(b => [b.id, b.businessName]));
  const actionLabel = (blueprintId: string | null): string =>
    blueprintId ? (clientNameById.get(blueprintId) ?? "a client") : "portfolio";

  const actionsSummary = recentActions.length === 0
    ? "No autonomous actions in the last 24 hours."
    : recentActions
        .map(a => `  • [${a.actionType}] ${actionLabel(a.blueprintId)}: ${a.reasoning.slice(0, 120)}`)
        .join("\n");

  // Last 5 portfolio-level (chief-of-staff) actions — your own prior briefings/alerts.
  const portfolioActions = recentActions.filter(a => a.blueprintId === null).slice(0, 5);
  const portfolioSummary = portfolioActions.length === 0
    ? "No portfolio-level briefings yet."
    : portfolioActions
        .map(a => `  • [${a.actionType}] ${a.reasoning.slice(0, 160)}`)
        .join("\n");

  const systemPrompt =
    `You are the Chief of Staff for this agency. You have visibility across ALL clients ` +
    `and you think like a COO: you spot patterns, flag risks, identify opportunities, and brief ` +
    `the agency owner on what matters most today. You speak in first person, are direct and ` +
    `confident, and give clear actionable insights. ` +
    `Keep answers concise — two to four sentences unless asked for detail.\n\n` +
    `Current agency snapshot:\n` +
    `  Total clients: ${blueprints.length}\n` +
    `  Total leads across all clients: ${totalLeads}\n` +
    `  Total appointments across all clients: ${totalAppointments}\n\n` +
    `Client breakdown:\n${clientsSummary}\n\n` +
    `Agent actions taken in last 24h:\n${actionsSummary}\n\n` +
    `Your recent portfolio-level briefings:\n${portfolioSummary}`;

  // ── Stream GPT-4o response ───────────────────────────────────────────────
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        const completion = await openai.chat.completions.create({
          model:       "gpt-4o",
          messages:    [
            { role: "system", content: systemPrompt },
            { role: "user",   content: message },
          ],
          stream:      true,
          max_tokens:  400,
          temperature: 0.7,
        });

        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
      } catch (err) {
        console.error("[agency-chat] OpenAI stream error:", err);
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ text: "I'm still getting set up. Check back shortly." })}\n\n`)
        );
      } finally {
        controller.enqueue(enc.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
    },
  });
}
