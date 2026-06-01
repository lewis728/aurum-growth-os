/**
 * src/lib/training/callerTrainer.ts
 * SERVER-SIDE ONLY. Per-vertical adversarial call simulation for Sophie (Part 4).
 *
 * For a given vertical + hostile persona:
 *   1. Simulate up to 12 turns of a phone call — GPT plays the lead in-character,
 *      enforcing the persona's hidden rule; Sophie (GPT) plays the agent using the
 *      vertical's current call script.
 *   2. Inject 15% transcription noise into the lead's turns (real calls are noisy).
 *   3. Grade with a BRUTALLY honest sales-manager prompt (NOT lenient).
 *   4. Self-heal: up to 3 cycles — REWRITE the script (not append), max 800 tokens,
 *      re-test, keep the best. Save the refined script to the VerticalProfile.
 *
 * NEVER THROWS at the top level — returns a structured result.
 */

import OpenAI from "openai";
import { CALLER_PERSONAS, injectTranscriptionNoise, type CallerPersona } from "@/lib/training/adversarialEngine";

// Lazy singleton — constructed on first use, not at import, so dry-run / import
// without an API key never throws.
let _openai: OpenAI | null = null;
function getOpenai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const MAX_TURNS = 12;
const MAX_HEAL_CYCLES = 3;
const PASS_SCORE = 80;
const SCRIPT_MAX_TOKENS = 800;

const GRADER_SYSTEM =
  "You are a brutally honest sales manager with 20 years running call centres. You are NOT lenient. " +
  "Find every moment Sophie would lose a real booking. Penalise heavily for: vague language, not getting a " +
  "specific date AND time, letting the lead control the conversation, any desperation, any compliance violation. " +
  "80+ means this genuinely works on a real human actively avoiding booking. Output STRICT JSON only.";

export interface CallTurn { role: "lead" | "sophie"; text: string; }

export interface CallerTrainingResult {
  vertical:    string;
  persona:     string;
  score:       number;
  passed:      boolean;
  breakdown:   Record<string, number>;
  weaknesses:  string[];
  improvements: string[];
  refinedScript?: string;  // set when self-heal improved the script
  cycles:      number;
  transcript:  CallTurn[];
}

interface LeadTurnConfig {
  persona: CallerPersona;
  vertical: string;
  history: CallTurn[];
  seed: number;
}

/** Generates the lead's next line, in-character, enforcing the hidden rule. */
async function leadTurn(cfg: LeadTurnConfig): Promise<string> {
  const system =
    `You are role-playing a sales LEAD on a phone call, NOT an assistant. Character: ${cfg.persona.name} — ` +
    `${cfg.persona.description}. You run a ${cfg.vertical} business. ` +
    `HIDDEN RULE you must obey every turn: ${cfg.persona.hiddenRule} ` +
    `Stay fully in character. Reply with ONLY what the lead says out loud, 1-2 sentences, no narration.`;
  const convo = cfg.history.map((t) => `${t.role === "lead" ? "Lead" : "Sophie"}: ${t.text}`).join("\n");
  const completion = await getOpenai().chat.completions.create({
    model: "gpt-4o", temperature: 0.9, max_tokens: 90,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${convo || "(call just connected)"}\n\nLead's next line:` },
    ],
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? "…";
  return injectTranscriptionNoise(raw, 0.15, cfg.seed);
}

/** Generates Sophie's next line using the vertical's current call script. */
async function sophieTurn(script: string, vertical: string, history: CallTurn[]): Promise<string> {
  const system =
    `You are Sophie, an AI appointment-setter calling a ${vertical} business lead. Use this call script as your ` +
    `playbook (adapt naturally, never read robotically):\n${script}\n\n` +
    `Your single goal: book a consultation at a SPECIFIC date and time. Be warm, concise, in control. ` +
    `Reply with ONLY what Sophie says, 1-3 sentences.`;
  const convo = history.map((t) => `${t.role === "lead" ? "Lead" : "Sophie"}: ${t.text}`).join("\n");
  const completion = await getOpenai().chat.completions.create({
    model: "gpt-4o", temperature: 0.6, max_tokens: 140,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${convo || "(call just connected — open the call)"}\n\nSophie's next line:` },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "…";
}

/** Runs one full simulated call. Returns the transcript. */
async function simulateCall(persona: CallerPersona, vertical: string, script: string, seedBase: number): Promise<CallTurn[]> {
  const history: CallTurn[] = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Sudden-death persona: deterministic 8%-ish hangup chance per turn.
    if (persona.key === "sudden_death" && turn > 1) {
      const n = Math.abs(Math.sin((seedBase + turn) * 91.7) * 43758.5453);
      if (n - Math.floor(n) < 0.08) { history.push({ role: "lead", text: "[hangs up abruptly]" }); break; }
    }
    const sophie = await sophieTurn(script, vertical, history);
    history.push({ role: "sophie", text: sophie });
    const lead = await leadTurn({ persona, vertical, history, seed: seedBase + turn });
    history.push({ role: "lead", text: lead });
    if (/\b(booked|see you|confirmed|that works|sounds good)\b/i.test(lead)) break;
  }
  return history;
}

interface Grade { score: number; breakdown: Record<string, number>; weaknesses: string[]; improvements: string[]; }

async function gradeCall(vertical: string, persona: CallerPersona, transcript: CallTurn[]): Promise<Grade> {
  const convo = transcript.map((t) => `${t.role === "lead" ? "Lead" : "Sophie"}: ${t.text}`).join("\n");
  const user = [
    `Vertical: ${vertical}. Persona: ${persona.name} (${persona.description}). Win condition: ${persona.winCondition}`,
    ``,
    `TRANSCRIPT:\n${convo}`,
    ``,
    `Grade Sophie. Return JSON: {"score": number 0-100, "breakdown": {"control": number, "specificBooking": number, "objectionHandling": number, "compliance": number, "noDesperation": number}, "weaknesses": string[], "improvements": string[] (concrete script changes)}.`,
  ].join("\n");
  const completion = await getOpenai().chat.completions.create({
    model: "gpt-4o", temperature: 0.2, max_tokens: 600,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: GRADER_SYSTEM }, { role: "user", content: user }],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<Grade>;
  return {
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0,
    breakdown: parsed.breakdown ?? {},
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
  };
}

/** REWRITES the call script to fix the graded weaknesses (not append), capped. */
async function rewriteScript(vertical: string, currentScript: string, grade: Grade): Promise<string> {
  const completion = await getOpenai().chat.completions.create({
    model: "gpt-4o", temperature: 0.5, max_tokens: SCRIPT_MAX_TOKENS,
    messages: [
      { role: "system", content:
        `You are a world-class sales-script writer. REWRITE the ${vertical} call script in full to fix the weaknesses — ` +
        `do NOT append notes, produce a clean complete replacement script. Keep it tight and natural for a phone call.` },
      { role: "user", content:
        `Current script:\n${currentScript}\n\nWeaknesses to fix:\n- ${grade.weaknesses.join("\n- ")}\n\n` +
        `Concrete improvements requested:\n- ${grade.improvements.join("\n- ")}\n\nReturn ONLY the new script.` },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? currentScript;
}

/**
 * Trains Sophie on ONE vertical+persona, self-healing up to 3 cycles.
 * Returns the best result + the refined script if it improved. NEVER THROWS.
 */
export async function trainCallerScenario(opts: {
  vertical: string; persona: CallerPersona; baseScript: string; seed: number;
}): Promise<CallerTrainingResult> {
  const { vertical, persona, seed } = opts;
  let script = opts.baseScript;
  let best: CallerTrainingResult = {
    vertical, persona: persona.key, score: 0, passed: false, breakdown: {},
    weaknesses: [], improvements: [], cycles: 0, transcript: [],
  };
  try {
    for (let cycle = 1; cycle <= MAX_HEAL_CYCLES; cycle++) {
      const transcript = await simulateCall(persona, vertical, script, seed + cycle * 100);
      const grade = await gradeCall(vertical, persona, transcript);
      if (grade.score > best.score) {
        best = {
          vertical, persona: persona.key, score: grade.score, passed: grade.score >= PASS_SCORE,
          breakdown: grade.breakdown, weaknesses: grade.weaknesses, improvements: grade.improvements,
          refinedScript: cycle > 1 ? script : undefined, cycles: cycle, transcript,
        };
      }
      if (grade.score >= PASS_SCORE) break;             // good enough, stop healing
      if (cycle < MAX_HEAL_CYCLES) script = await rewriteScript(vertical, script, grade);
    }
    return best;
  } catch (err) {
    console.error(`[callerTrainer] ${vertical}/${persona.key} failed:`, err instanceof Error ? err.message : err);
    return best;
  }
}

export { CALLER_PERSONAS, PASS_SCORE };
