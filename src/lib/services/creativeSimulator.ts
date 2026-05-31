/**
 * src/lib/services/creativeSimulator.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Pre-flight creative simulation (Sprint 10C-B). Before any ad creative is
 * deployed to Meta, GPT-4o role-plays 15 psychographic personas drawn from the
 * client's brief and scores the creative. No client capital is spent on an
 * unproven angle: a creative that doesn't clear the bar is BLOCKED and returned
 * with the personas' objections so the generator can revise.
 *
 * NEVER THROWS — on any failure it returns a non-passing result with the reason,
 * so the caller treats "couldn't simulate" the same as "didn't pass" (fail safe:
 * never auto-deploy unproven creative).
 */

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { buildClientContext } from "@/lib/agents/clientContext";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PERSONA_COUNT = 15;
const PASS_THRESHOLD = 7.5;

export interface CreativeInput {
  creativeId: string;
  headline:   string;
  hook:       string;
  body?:      string;
  imageDescription?: string;
}

export interface PersonaScore {
  persona:      string;
  score:        number;   // 1-10 click probability
  objection:    string;
  wouldConvert: boolean;
}

export interface SimulationResult {
  creativeId:    string;
  meanScore:     number;
  passed:        boolean;
  blockedReason: string | null;
  personaScores: PersonaScore[];
}

interface RawSim {
  personas?: Array<{ persona?: string; score?: number; objection?: string; wouldConvert?: boolean }>;
  policyFlag?: boolean;
  policyReason?: string;
}

/**
 * Simulates one creative against 15 GPT-personas. Persists a CreativeSimulation
 * row. NEVER THROWS — returns passed=false on any failure.
 */
export async function simulateCreative(
  blueprintId: string,
  tenantId: string,
  creative: CreativeInput,
): Promise<SimulationResult> {
  const fail = (reason: string): SimulationResult => ({
    creativeId: creative.creativeId, meanScore: 0, passed: false, blockedReason: reason, personaScores: [],
  });

  try {
    if (!process.env.OPENAI_API_KEY) return fail("Simulation unavailable (no AI key) — not auto-approved.");

    const ctx = await buildClientContext(blueprintId);

    const system =
      `You simulate a target-market focus group for ${ctx.businessName} (${ctx.vertical}). ` +
      `Generate exactly ${PERSONA_COUNT} realistic psychographic personas matching this client's ideal ` +
      `customer (use the brief: age range, income, skepticism, time-sensitivity, pain points). For EACH ` +
      `persona, react to the ad creative honestly — would it stop your scroll, would you click, would you ` +
      `convert? Be a tough, realistic audience, not a cheerleader.\n${ctx.promptBlock}\n\n` +
      `Also raise policyFlag=true if the creative makes a claim that breaches advertising standards or the ` +
      `client's compliance notes.\n` +
      `Respond ONLY as JSON: {"personas": [{"persona": short string, "score": 1-10 integer click probability, ` +
      `"objection": short string, "wouldConvert": boolean}], "policyFlag": boolean, "policyReason": string}.`;

    const user =
      `AD CREATIVE\nHeadline: ${creative.headline}\nHook: ${creative.hook}\n` +
      (creative.body ? `Body: ${creative.body}\n` : "") +
      (creative.imageDescription ? `Visual: ${creative.imageDescription}\n` : "") +
      `\nSimulate all ${PERSONA_COUNT} personas now.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", temperature: 0.7, max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as RawSim;
    const personaScores: PersonaScore[] = Array.isArray(raw.personas)
      ? raw.personas.map((p) => ({
          persona:      typeof p.persona === "string" ? p.persona : "persona",
          score:        typeof p.score === "number" ? Math.max(1, Math.min(10, p.score)) : 1,
          objection:    typeof p.objection === "string" ? p.objection : "",
          wouldConvert: p.wouldConvert === true,
        }))
      : [];

    if (personaScores.length === 0) return fail("Simulation returned no personas — not auto-approved.");

    const meanScore = Math.round((personaScores.reduce((s, p) => s + p.score, 0) / personaScores.length) * 100) / 100;
    const policyBlocked = raw.policyFlag === true;
    const passed = meanScore >= PASS_THRESHOLD && !policyBlocked;
    const blockedReason = passed
      ? null
      : policyBlocked
        ? `Policy/compliance flag: ${raw.policyReason ?? "potential ad-standards breach"}`
        : `Mean score ${meanScore} below ${PASS_THRESHOLD}. Top objections: ${topObjections(personaScores)}`;

    await prisma.creativeSimulation.create({
      data: {
        blueprintId, tenantId, creativeId: creative.creativeId,
        personaScores: personaScores as unknown as object[],
        meanScore, passed, blockedReason,
      },
    }).catch((e: unknown) => console.error("[creativeSimulator] persist failed:", e instanceof Error ? e.message : e));

    return { creativeId: creative.creativeId, meanScore, passed, blockedReason, personaScores };
  } catch (err) {
    console.error(`[creativeSimulator] failed for ${creative.creativeId}:`, err instanceof Error ? err.message : err);
    return fail("Simulation error — not auto-approved.");
  }
}

function topObjections(scores: PersonaScore[]): string {
  const counts = new Map<string, number>();
  for (const s of scores) {
    const o = s.objection.trim().toLowerCase();
    if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([o]) => o).join("; ") || "none given";
}
