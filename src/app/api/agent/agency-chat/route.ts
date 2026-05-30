/**
 * POST /api/agent/agency-chat
 *
 * Agency-level chief-of-staff chat. Has visibility across ALL blueprints
 * for this tenant — leads, appointments, agent actions taken in last 24h.
 * Streams SSE response tokens.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<Response> {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = orgId;

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });
  }

  const body = (await req.json()) as { message?: string };
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // ── Fetch agency-wide context in parallel ────────────────────────────────
  const [blueprints, recentActions] = await Promise.all([
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

  const actionsSummary = recentActions.length === 0
    ? "No autonomous actions in the last 24 hours."
    : recentActions
        .map(a => `  • [${a.actionType}] ${a.blueprintId.slice(0, 8)}: ${a.reasoning.slice(0, 120)}`)
        .join("\n");

  const systemPrompt =
    `You are the agency chief of staff for an Aurum Growth OS account. ` +
    `You have visibility across ALL of the agency owner's clients. ` +
    `You speak in first person, are direct and confident, and give clear actionable insights. ` +
    `You know about every campaign, every lead, every booking. ` +
    `Report like a senior account director giving a morning briefing to the agency owner. ` +
    `Keep answers concise — two to four sentences unless asked for detail.\n\n` +
    `Current agency snapshot:\n` +
    `  Total clients: ${blueprints.length}\n` +
    `  Total leads across all clients: ${totalLeads}\n` +
    `  Total appointments across all clients: ${totalAppointments}\n\n` +
    `Client breakdown:\n${clientsSummary}\n\n` +
    `Agent actions taken in last 24h:\n${actionsSummary}`;

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
        const msg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ text: `Error: ${msg}` })}\n\n`));
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
