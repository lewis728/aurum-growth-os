/**
 * src/lib/crm/conversationState.ts
 * SERVER-SIDE-safe pure logic (no imports) — the lead conversation FSM (Sprint 10C).
 *
 * Every lead has a deterministic conversationState. The LLM adapts tone, but the
 * STRUCTURE is a finite-state machine so Sophie can't get lost on edge cases.
 *
 *   INITIAL → QUALIFYING → OBJECTION_HANDLING → NEGOTIATING → BOOKING → CONFIRMED
 *   (any state) + 24h silence → DORMANT
 *   DORMANT + reply to re-engagement → REENGAGED
 *
 * State is derived from observable signals (call outcome, appointment, objection,
 * silence), so it never desyncs from reality — same philosophy as the pipeline.
 */

export const CONVERSATION_STATES = [
  "INITIAL", "QUALIFYING", "OBJECTION_HANDLING", "NEGOTIATING",
  "BOOKING", "CONFIRMED", "DORMANT", "REENGAGED",
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export interface ConversationSignals {
  current:           ConversationState;
  booked:            boolean;  // an appointment now exists
  objectionRaised:   boolean;  // lead voiced an objection on the call
  qualified:         boolean;  // lead answered + qualified
  contacted:         boolean;  // a call was placed/answered (no booking yet)
  repliedToReengage: boolean;  // lead replied to a re-engagement message
}

/**
 * Deterministic next state. Pure + total — always returns a valid state.
 * Precedence: booked > replied-to-reengage > objection > qualified > contacted.
 */
export function nextConversationState(s: ConversationSignals): ConversationState {
  if (s.booked) return "CONFIRMED";
  if (s.current === "DORMANT" && s.repliedToReengage) return "REENGAGED";
  if (s.objectionRaised) return "OBJECTION_HANDLING";
  // Once past qualifying without booking, an objection-handled lead negotiates.
  if (s.current === "OBJECTION_HANDLING" && s.qualified) return "NEGOTIATING";
  if (s.qualified) return "QUALIFYING";
  if (s.contacted) return s.current === "INITIAL" ? "QUALIFYING" : s.current;
  return s.current;
}

/** A lead is "open" (worth re-engaging) if not booked, not dormant, not dead. */
export function isOpenForReengagement(state: ConversationState): boolean {
  return state !== "CONFIRMED" && state !== "DORMANT";
}
