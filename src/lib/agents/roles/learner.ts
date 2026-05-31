/**
 * src/lib/agents/roles/learner.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── THE LEARNER ("Kai") — THE MOAT ──────────────────────────────────────────
 * The fifth specialist role (caller · scheduler · mediaBuyer · reporter · learner).
 * See roles/caller.ts for the shared role contract.
 *
 * KAI'S JOB: every night, read the last 30 days of THIS client's outcomes and
 * distil them into ≤15 sharp, specific, ACTIONABLE facts — the kind a brilliant
 * human analyst would scribble on an index card. Saves them to
 * ClientBrief.distilledLearnings, which every other role reads at the start of
 * every cycle (via clientContext.renderBriefBlock). That is the compound learning
 * effect: the team is measurably sharper every night.
 *
 * DB-only handoff: Kai never calls another role. It reads the rows other roles
 * wrote (Lead, Appointment, AgentAction) and writes one field other roles read.
 *
 * NEVER THROWS — returns a result object so the cron settles cleanly. If there's
 * too little data to learn from, it no-ops rather than inventing patterns.
 */

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FACTS = 15;
// Below this much signal, distillation would be guessing, not learning.
const MIN_LEADS_TO_LEARN = 5;

export interface LearnerResult {
  blueprintId: string;
  status: "updated" | "skipped_no_data" | "skipped_no_openai" | "error";
  factCount?: number;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CallAnalysisShape {
  objections?: unknown;
  transcript?: string;
  call_analysis?: { call_summary?: string };
  custom_analysis_data?: { summary?: string };
}

/** Bucket an hour into a readable slot for show-rate patterns. */
function hourSlot(hour: number): string {
  if (hour < 6)  return "overnight (12am-6am)";
  if (hour < 12) return "morning (6am-12pm)";
  if (hour < 17) return "afternoon (12pm-5pm)";
  if (hour < 21) return "evening (5pm-9pm)";
  return "late (9pm-12am)";
}

/**
 * Distil 30 days of one client's outcomes into actionable learnings.
 * NEVER THROWS.
 */
export async function runLearnerCycle(
  blueprintId: string,
  tenantId: string,
): Promise<LearnerResult> {
  try {
    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const [blueprint, brief, leads, appointments, actions] = await Promise.all([
      prisma.campaignBlueprint.findFirst({
        where:  { id: blueprintId, tenantId },
        select: { businessName: true, vertical: true },
      }),
      prisma.clientBrief.findUnique({ where: { blueprintId }, select: { id: true } }),
      prisma.lead.findMany({
        where:  { blueprintId, tenantId, createdAt: { gte: since } },
        select: { status: true, pipelineStage: true, leadScore: true, callAnalysis: true, createdAt: true },
      }),
      prisma.appointment.findMany({
        where:  { blueprintId, tenantId, createdAt: { gte: since } },
        select: { status: true, scheduledAt: true },
      }),
      prisma.agentAction.findMany({
        where:   { blueprintId, tenantId, executedAt: { gte: since } },
        orderBy: { executedAt: "desc" },
        take:    100,
        select:  { actionType: true, reasoning: true, outcome: true },
      }),
    ]);

    if (!blueprint) return { blueprintId, status: "error" };

    // Not enough signal to learn responsibly — no-op (don't fabricate patterns).
    if (leads.length < MIN_LEADS_TO_LEARN) {
      return { blueprintId, status: "skipped_no_data" };
    }
    if (!process.env.OPENAI_API_KEY) {
      return { blueprintId, status: "skipped_no_openai" };
    }

    // ── Aggregate the raw signal into a compact, GPT-readable evidence pack ────

    // Lead outcomes by status + pipeline stage.
    const byStatus: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    const objectionCounts: Record<string, number> = {};
    let withCalls = 0;
    for (const l of leads) {
      byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      byStage[l.pipelineStage] = (byStage[l.pipelineStage] ?? 0) + 1;
      const ca = l.callAnalysis as CallAnalysisShape | null;
      if (ca) {
        withCalls++;
        if (Array.isArray(ca.objections)) {
          for (const o of ca.objections) {
            if (typeof o === "string" && o.trim()) {
              const k = o.trim().toLowerCase();
              objectionCounts[k] = (objectionCounts[k] ?? 0) + 1;
            }
          }
        }
      }
    }

    // Show rate by day-of-week + time slot (attended vs total past appointments).
    const slotTotals: Record<string, { total: number; attended: number }> = {};
    const now = Date.now();
    for (const a of appointments) {
      const past = a.scheduledAt.getTime() < now;
      if (!past) continue;
      const key = `${DOW[a.scheduledAt.getDay()]} ${hourSlot(a.scheduledAt.getHours())}`;
      const cell = slotTotals[key] ?? { total: 0, attended: 0 };
      cell.total++;
      if (a.status === "attended") cell.attended++;
      slotTotals[key] = cell;
    }
    const slotLines = Object.entries(slotTotals)
      .filter(([, v]) => v.total >= 2) // need ≥2 to be a pattern, not an anecdote
      .map(([k, v]) => `  ${k}: ${v.attended}/${v.total} showed (${Math.round((v.attended / v.total) * 100)}%)`)
      .join("\n") || "  (not enough completed appointments to detect slot patterns)";

    // Action mix.
    const actionMix: Record<string, number> = {};
    for (const a of actions) actionMix[a.actionType] = (actionMix[a.actionType] ?? 0) + 1;

    const totalLeads  = leads.length;
    const booked      = byStatus["booked"] ?? 0;
    const bookingRate = totalLeads > 0 ? Math.round((booked / totalLeads) * 100) : 0;
    const avgScore    = (() => {
      const scored = leads.filter((l) => l.leadScore != null);
      if (!scored.length) return null;
      return Math.round((scored.reduce((s, l) => s + (l.leadScore ?? 0), 0) / scored.length) * 10) / 10;
    })();

    const objectionLines = Object.entries(objectionCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([o, c]) => `  "${o}": ${c}×`).join("\n") || "  (none extracted)";

    const evidence = [
      `Client: ${blueprint.businessName} (${blueprint.vertical})`,
      `Window: last 30 days`,
      `Leads: ${totalLeads} | with call data: ${withCalls} | booking rate: ${bookingRate}% | avg lead score: ${avgScore ?? "n/a"}`,
      `Lead status mix: ${JSON.stringify(byStatus)}`,
      `Pipeline stage mix: ${JSON.stringify(byStage)}`,
      `Objections heard:\n${objectionLines}`,
      `Show rate by day + time slot:\n${slotLines}`,
      `Agent action mix (30d): ${JSON.stringify(actionMix)}`,
    ].join("\n\n");

    // ── GPT-4o distillation ──────────────────────────────────────────────────
    const systemPrompt =
      `You are Kai, the learning analyst for an AI marketing team running campaigns for ` +
      `${blueprint.businessName}. You read the last 30 days of THIS client's real outcomes ` +
      `and distil them into at most ${MAX_FACTS} SHARP, SPECIFIC, ACTIONABLE facts that will ` +
      `make the caller, scheduler, media buyer and reporter smarter about THIS client.\n` +
      `Rules:\n` +
      `- Each fact must be backed by the evidence given. NEVER invent a number or pattern.\n` +
      `- Prefer facts that change behaviour, e.g. "Tuesday morning slots show at 80% vs 45% overall — ` +
      `push bookings there" or "the 'too expensive' objection is the top blocker (6×) — lead with ` +
      `finance options".\n` +
      `- If the evidence is too thin for a category, say nothing about it rather than guessing.\n` +
      `- One fact per line, prefixed with "- ". No preamble, no headings, no closing remarks.\n` +
      `- Plain English. No vendor/technology names.`;

    const completion = await openai.chat.completions.create({
      model:       "gpt-4o",
      temperature: 0.3,
      max_tokens:  700,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: `Evidence:\n\n${evidence}\n\nDistil the learnings now.` },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return { blueprintId, status: "error" };

    // Keep only bullet lines, cap at MAX_FACTS.
    const facts = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .slice(0, MAX_FACTS);
    const distilled = (facts.length ? facts : [raw]).join("\n");

    // Persist. Brief may not exist yet for an un-onboarded client — upsert.
    if (brief) {
      await prisma.clientBrief.update({
        where: { blueprintId },
        data:  { distilledLearnings: distilled, learningsUpdatedAt: new Date() },
      });
    } else {
      await prisma.clientBrief.create({
        data: { blueprintId, tenantId, distilledLearnings: distilled, learningsUpdatedAt: new Date() },
      });
    }

    return { blueprintId, status: "updated", factCount: facts.length };
  } catch (err) {
    console.error(`[learner] cycle failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { blueprintId, status: "error" };
  }
}
