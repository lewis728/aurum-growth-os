/**
 * src/lib/training/mediaBuyerTrainer.ts
 * SERVER-SIDE ONLY. Per-vertical Meta scenario training for Marcus (Part 4).
 *
 * For each campaign scenario: present the (optionally ±30%-noised) situation to
 * Marcus's reasoning (GPT-4o), capture his chosen action + reason, then grade
 * against the KNOWN correct decision. Partial credit when the action is right but
 * the reason is weak, or the reason is right but the action is close-but-wrong.
 *
 * NEVER THROWS at the top level.
 */

import OpenAI from "openai";
import { applyStochasticNoise, type CampaignScenario } from "@/lib/training/adversarialEngine";

// Lazy singleton — see callerTrainer for rationale (dry-run import must not throw).
let _openai: OpenAI | null = null;
function getOpenai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const PASS_SCORE = 80;

export interface MediaBuyerTrainingResult {
  vertical:     string;
  scenario:     string;
  score:        number;
  passed:       boolean;
  chosenAction: string;
  correctAction: string;
  breakdown:    Record<string, number>;
  weaknesses:   string[];
  improvements: string[];
}

interface MarcusDecision { action: string; reasoning: string; }

/** Marcus decides on the scenario, using the same persona as the live media buyer. */
async function marcusDecide(vertical: string, situation: string): Promise<MarcusDecision> {
  const completion = await getOpenai().chat.completions.create({
    model: "gpt-4o", temperature: 0.3, max_tokens: 400,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content:
        `You are Marcus, a Meta ads expert with 30 years' experience managing one ${vertical} client's campaign. ` +
        `You know: never touch a campaign in the LEARNING phase (needs ~50 conversions to exit); frequency >3.0 = ` +
        `creative fatigue; CPM spikes with no internal change = external auction; a Meta-vs-CRM conversion mismatch ` +
        `= broken tracking, not a bad campaign; scale in ≤20% steps; 'Learning Limited' = too little volume. ` +
        `Choose exactly ONE decision and justify it. Output JSON: {"action": string, "reasoning": string}.` },
      { role: "user", content: `Campaign situation:\n${situation}\n\nWhat do you do, and why?` },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<MarcusDecision>;
  return {
    action: typeof parsed.action === "string" ? parsed.action : "",
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
  };
}

/** Grades Marcus's decision against the known-correct answer (partial credit). */
async function gradeDecision(scenario: CampaignScenario, decision: MarcusDecision): Promise<{ score: number; breakdown: Record<string, number>; weaknesses: string[]; improvements: string[] }> {
  const user = [
    `SCENARIO: ${scenario.situation}`,
    `CORRECT ACTION: ${scenario.correctAction}`,
    `CORRECT REASONING: ${scenario.correctReason}`,
    `THE TRAP (wrong but tempting): ${scenario.trap}`,
    ``,
    `MARCUS CHOSE: ${decision.action}`,
    `MARCUS'S REASONING: ${decision.reasoning}`,
    ``,
    `Grade strictly. Full marks only if the action matches the correct decision AND the reasoning shows he understood WHY (not luck). ` +
    `Award PARTIAL credit if the action is close-but-wrong for the right reason, or the right action for a weak reason. ` +
    `Zero if he fell for the trap. Return JSON: {"score": number 0-100, "breakdown": {"actionCorrect": number, "reasoningCorrect": number, "avoidedTrap": number}, "weaknesses": string[], "improvements": string[]}.`,
  ].join("\n");
  const completion = await getOpenai().chat.completions.create({
    model: "gpt-4o", temperature: 0.2, max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a brutally honest head of performance marketing grading a media buyer's judgement. NOT lenient. Output STRICT JSON only." },
      { role: "user", content: user },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { score?: number; breakdown?: Record<string, number>; weaknesses?: string[]; improvements?: string[] };
  return {
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0,
    breakdown: parsed.breakdown ?? {},
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
  };
}

/** Trains Marcus on ONE vertical+scenario. NEVER THROWS. */
export async function trainMediaBuyerScenario(opts: {
  vertical: string; scenario: CampaignScenario; seed: number;
}): Promise<MediaBuyerTrainingResult> {
  const { vertical, scenario, seed } = opts;
  const base: MediaBuyerTrainingResult = {
    vertical, scenario: scenario.key, score: 0, passed: false,
    chosenAction: "", correctAction: scenario.correctAction, breakdown: {}, weaknesses: [], improvements: [],
  };
  try {
    // Apply ±30% stochastic noise to any numbers in the situation when flagged.
    let situation = scenario.situation;
    if (scenario.stochasticNoise) {
      situation = situation.replace(/(\d+(?:\.\d+)?)/g, (m, _g, idx: number) =>
        String(applyStochasticNoise(parseFloat(m), seed + idx)),
      );
    }
    const decision = await marcusDecide(vertical, situation);
    const grade = await gradeDecision(scenario, decision);
    return {
      ...base,
      score: grade.score, passed: grade.score >= PASS_SCORE, chosenAction: decision.action,
      breakdown: grade.breakdown, weaknesses: grade.weaknesses, improvements: grade.improvements,
    };
  } catch (err) {
    console.error(`[mediaBuyerTrainer] ${vertical}/${scenario.key} failed:`, err instanceof Error ? err.message : err);
    return base;
  }
}

export { PASS_SCORE };
