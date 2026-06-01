/**
 * src/lib/training/shadowMode.ts
 * SERVER-SIDE ONLY. 14-day shadow deployment (Part 4).
 *
 * In shadow mode an agent receives REAL data and decides as normal, but the
 * execution layer is blocked — the intended action + reasoning are logged to
 * ShadowAction instead of being applied. After 14 days, if the agent's decisions
 * were correct ≥85% of the time, it auto-promotes to live execution.
 *
 * This module is the thin contract: log a shadow decision, and evaluate promotion.
 * Whoever wires execution checks isAgentLive() before mutating anything external.
 * NEVER THROWS.
 */

import { prisma } from "@/lib/prisma";

export const SHADOW_WINDOW_DAYS = 14;
export const PROMOTION_ACCURACY = 0.85;

/** Records an intended (but not executed) agent decision during shadow mode. */
export async function logShadowAction(input: {
  tenantId: string;
  blueprintId: string;
  agentRole: string;
  intendedAction: string;
  intendedReasoning: string;
}): Promise<void> {
  try {
    await prisma.shadowAction.create({
      data: {
        tenantId: input.tenantId,
        blueprintId: input.blueprintId,
        agentRole: input.agentRole,
        intendedAction: input.intendedAction,
        intendedReasoning: input.intendedReasoning.slice(0, 4000),
      },
    });
  } catch (err) {
    console.error("[shadowMode] log failed:", err instanceof Error ? err.message : err);
  }
}

/** Grades a past shadow action once its real-world outcome is known. */
export async function gradeShadowAction(id: string, actualOutcome: string, wasCorrect: boolean): Promise<void> {
  try {
    await prisma.shadowAction.update({
      where: { id },
      data: { actualOutcome: actualOutcome.slice(0, 2000), wasCorrect },
    });
  } catch (err) {
    console.error("[shadowMode] grade failed:", err instanceof Error ? err.message : err);
  }
}

export interface PromotionStatus {
  blueprintId: string;
  agentRole: string;
  graded: number;
  correct: number;
  accuracy: number;
  daysObserved: number;
  promote: boolean;   // true → safe to flip to live execution
  reason: string;
}

/**
 * Evaluates whether an agent should be promoted out of shadow mode. NEVER THROWS.
 * Promotes only when BOTH the 14-day window has elapsed AND graded accuracy ≥85%
 * over a meaningful sample (≥10 graded decisions).
 */
export async function evaluatePromotion(tenantId: string, blueprintId: string, agentRole: string): Promise<PromotionStatus> {
  const base: PromotionStatus = {
    blueprintId, agentRole, graded: 0, correct: 0, accuracy: 0, daysObserved: 0, promote: false, reason: "no data",
  };
  try {
    const actions = await prisma.shadowAction.findMany({
      where: { tenantId, blueprintId, agentRole }, // tenant-scoped
      select: { wasCorrect: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (actions.length === 0) return base;

    const graded = actions.filter((a) => a.wasCorrect !== null);
    const correct = graded.filter((a) => a.wasCorrect === true).length;
    const accuracy = graded.length > 0 ? correct / graded.length : 0;
    const firstAt = actions[0].createdAt.getTime();
    const daysObserved = (Date.now() - firstAt) / (24 * 60 * 60 * 1000);

    const windowMet = daysObserved >= SHADOW_WINDOW_DAYS;
    const sampleMet = graded.length >= 10;
    const accuracyMet = accuracy >= PROMOTION_ACCURACY;
    const promote = windowMet && sampleMet && accuracyMet;

    const reason = promote
      ? `Promote: ${(accuracy * 100).toFixed(0)}% over ${graded.length} decisions across ${daysObserved.toFixed(0)} days.`
      : `Hold: ${windowMet ? "" : `${(SHADOW_WINDOW_DAYS - daysObserved).toFixed(0)} more days; `}${sampleMet ? "" : `${10 - graded.length} more graded decisions; `}${accuracyMet ? "" : `accuracy ${(accuracy * 100).toFixed(0)}% < ${PROMOTION_ACCURACY * 100}%`}`.trim();

    return { blueprintId, agentRole, graded: graded.length, correct, accuracy: Number(accuracy.toFixed(3)), daysObserved: Number(daysObserved.toFixed(1)), promote, reason };
  } catch (err) {
    console.error("[shadowMode] evaluatePromotion failed:", err instanceof Error ? err.message : err);
    return base;
  }
}
