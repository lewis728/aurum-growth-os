/**
 * src/lib/services/morningBriefingService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Generates the daily first-person morning briefing that Sophie (the per-client
 * AIRepresentative) sends to the agency owner at 6am. Persisted to
 * CampaignBlueprint.lastBriefingText / lastBriefingAt and surfaced in the
 * client sub-account view.
 *
 * NEVER throws — returns null on any failure so the cron can settle gracefully.
 */

import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generates and persists a morning briefing for a single blueprint.
 * Returns the briefing text, or null if it could not be generated.
 */
export async function generateMorningBriefing(
  blueprintId: string,
  tenantId: string
): Promise<string | null> {
  try {
    const since = new Date(Date.now() - ONE_DAY_MS);

    // ── Gather context in parallel ──────────────────────────────────────────
    const [blueprint, rep, recentActions, leadCount, appointmentCount, instructions] =
      await Promise.all([
        prisma.campaignBlueprint.findFirst({
          where:  { id: blueprintId, tenantId },
          select: { businessName: true, vertical: true, lastBriefingText: true },
        }),
        prisma.aIRepresentative.findUnique({
          where:  { blueprintId },
          select: { repName: true },
        }),
        prisma.agentAction.findMany({
          where:   { tenantId, blueprintId, executedAt: { gte: since } },
          orderBy: { executedAt: "desc" },
          take:    20,
          select:  { actionType: true, reasoning: true, outcome: true },
        }),
        prisma.lead.count({
          where: { tenantId, blueprintId, createdAt: { gte: since } },
        }),
        prisma.appointment.count({
          where: { tenantId, blueprintId, createdAt: { gte: since } },
        }),
        prisma.agentInstruction.findMany({
          where:  { tenantId, blueprintId, isActive: true },
          select: { instruction: true },
        }),
      ]);

    if (!blueprint) {
      console.warn(`[morningBriefing] Blueprint ${blueprintId} not found for tenant ${tenantId}`);
      return null;
    }

    const agentName = rep?.repName ?? "Your Agent";

    if (!process.env.OPENAI_API_KEY) {
      console.error("[morningBriefing] OPENAI_API_KEY is not set");
      return null;
    }

    // ── Build context block ─────────────────────────────────────────────────
    const actionsText = recentActions.length === 0
      ? "No autonomous actions in the last 24 hours."
      : recentActions.map(a => `- [${a.actionType}] ${a.reasoning} (${a.outcome})`).join("\n");

    const instructionsText = instructions.length === 0
      ? "No standing instructions."
      : instructions.map(i => `- ${i.instruction}`).join("\n");

    const context =
      `Overnight data (last 24 hours):\n` +
      `- New leads generated: ${leadCount}\n` +
      `- Appointments booked: ${appointmentCount}\n` +
      `- Actions you took:\n${actionsText}\n` +
      `- Standing instructions from the agency owner:\n${instructionsText}`;

    const systemPrompt =
      `You are ${agentName}, an AI media buyer managing ${blueprint.businessName}. ` +
      `Write a morning briefing to the agency owner. First person, confident, direct. ` +
      `3-5 sentences. Include what you did overnight, leads generated, appointments booked, ` +
      `ad changes and why. End with one forward-looking sentence. Sound like a competent ` +
      `staff member, not a chatbot. No bullet points.`;

    // ── Generate ────────────────────────────────────────────────────────────
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model:       "gpt-4o",
      temperature: 0.6,
      max_tokens:  280,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: context },
      ],
    });

    const briefingText = completion.choices[0]?.message?.content?.trim();
    if (!briefingText) {
      console.error(`[morningBriefing] Empty completion for blueprint ${blueprintId}`);
      return null;
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    await prisma.campaignBlueprint.update({
      where: { id: blueprintId },
      data:  { lastBriefingText: briefingText, lastBriefingAt: new Date() },
    });

    return briefingText;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[morningBriefing] Failed for blueprint ${blueprintId}: ${msg}`);
    return null;
  }
}
