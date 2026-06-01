/**
 * src/lib/training/certaintyIndex.ts
 * SERVER-SIDE ONLY. Marcus's confidence gate (Part 4).
 *
 * Certainty = consecutiveSteadyDays / (max(volatilityIndex, 0.01) × learningPhaseRisk)
 *
 * The max(volatilityIndex, 0.01) guard prevents division-by-zero when a brand-new
 * campaign has zero recorded volatility (Gemini-specified fix). Below the gate
 * (0.85) Marcus must NOT auto-execute — the caller intercepts, raises a Slack
 * alert, and routes to human approval. Pure functions; deterministic; no I/O.
 */

export type LearningPhase = "LEARNING" | "LEARNING_LIMITED" | "ACTIVE";

/** Risk multiplier — learning phases are riskier to touch, so they raise the bar. */
export const LEARNING_PHASE_RISK: Record<LearningPhase, number> = {
  LEARNING:         1.8,
  LEARNING_LIMITED: 2.2,
  ACTIVE:           1.0,
};

export const CERTAINTY_GATE = 0.85;
const MIN_VOLATILITY = 0.01; // division-by-zero guard

export interface CertaintyInput {
  consecutiveSteadyDays: number; // days the key metrics have held steady
  volatilityIndex:       number; // 0..1, how much CPL/CTR/freq are swinging
  learningPhase:         LearningPhase;
}

export interface CertaintyResult {
  score:    number;
  gate:     number;
  passes:   boolean;  // true → Marcus may auto-execute; false → intercept + approve
  rationale: string;
}

/** Computes Marcus's certainty score. NEVER THROWS (guards all inputs). */
export function computeCertainty(input: CertaintyInput): CertaintyResult {
  const steady = Number.isFinite(input.consecutiveSteadyDays) ? Math.max(0, input.consecutiveSteadyDays) : 0;
  const vol = Number.isFinite(input.volatilityIndex) ? Math.max(input.volatilityIndex, MIN_VOLATILITY) : 1;
  const risk = LEARNING_PHASE_RISK[input.learningPhase] ?? 1.0;

  const score = steady / (vol * risk);
  const passes = score >= CERTAINTY_GATE;

  const rationale = passes
    ? `Certainty ${score.toFixed(2)} ≥ ${CERTAINTY_GATE}: ${steady} steady days, low volatility (${vol.toFixed(2)}), ${input.learningPhase} phase — safe to act.`
    : `Certainty ${score.toFixed(2)} < ${CERTAINTY_GATE}: ${steady} steady days vs volatility ${vol.toFixed(2)} × ${input.learningPhase} risk ${risk} — hold for approval.`;

  return { score: Number(score.toFixed(3)), gate: CERTAINTY_GATE, passes, rationale };
}
