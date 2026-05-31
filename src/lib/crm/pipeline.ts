/**
 * src/lib/crm/pipeline.ts
 * SERVER-SIDE ONLY (pure logic — also safe to import in client for the stage list).
 *
 * The CRM pipeline (Sprint 3B). Rather than scatter pipelineStage writes across
 * every event site (lead webhook, call webhook, reminders cron, …) — which drifts
 * — the stage is DERIVED deterministically from the signals already persisted on
 * the Lead + its Appointment. One source of truth, impossible to desync.
 *
 * The Lead.pipelineStage column exists only so God Mode can aggregate pipeline
 * value with an indexed query; it's kept in sync lazily (see syncPipelineStage)
 * whenever leads are read, so it never needs a dedicated write at every event.
 *
 * The single EXPLICIT transition is "converted" — the agency owner marks a deal
 * won (and sets dealValue). That is stored on the row and always wins.
 */

export const PIPELINE_STAGES = [
  "new", "called", "qualified", "booked", "showed", "converted",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Sub-states are terminal-ish detours off the happy path, shown distinctly.
export const PIPELINE_SUBSTATES = [
  "no_answer", "no_show", "not_interested", "retry_queue",
] as const;
export type PipelineSubstate = (typeof PIPELINE_SUBSTATES)[number];

export type PipelineCell = PipelineStage | PipelineSubstate;

/** Ordered columns for the board: main stages, with sub-states grouped at the end. */
export const PIPELINE_BOARD_COLUMNS: PipelineCell[] = [
  "new", "called", "qualified", "booked", "showed", "converted",
  "no_answer", "no_show", "not_interested", "retry_queue",
];

export const PIPELINE_LABELS: Record<PipelineCell, string> = {
  new:            "New",
  called:         "Called",
  qualified:      "Qualified",
  booked:         "Booked",
  showed:         "Showed",
  converted:      "Converted",
  no_answer:      "No answer",
  no_show:        "No show",
  not_interested: "Not interested",
  retry_queue:    "Retry queue",
};

export interface PipelineSignals {
  leadStatus:        string;            // Lead.status
  callAttempts:      number;            // Lead.callAttempts
  convertedAt:       Date | null;       // Lead.convertedAt (explicit win)
  appointmentStatus: string | null;     // Appointment.status, if any
  appointmentPast:   boolean;           // appointment.scheduledAt < now
}

/**
 * Derives the canonical pipeline cell from the lead's signals. Pure + total —
 * always returns a valid cell, never throws.
 *
 * Precedence (first match wins):
 *   converted (explicit)  →  appointment outcome  →  lead status  →  new
 */
export function derivePipelineStage(s: PipelineSignals): PipelineCell {
  // 1. Explicit conversion always wins.
  if (s.convertedAt) return "converted";

  // 2. Appointment outcomes (most informative when present).
  if (s.appointmentStatus) {
    const a = s.appointmentStatus.toLowerCase();
    if (a === "attended")  return "showed";
    if (a === "no_show")   return "no_show";
    if (a === "cancelled") return "not_interested";
    // confirmed appointment in the past but not marked attended → treat as showed
    if (a === "confirmed" && s.appointmentPast) return "showed";
    // confirmed future appointment → booked
    if (a === "confirmed" || a === "scheduled") return "booked";
  }

  // 3. Lead status signals.
  switch (s.leadStatus.toLowerCase()) {
    case "converted":      return "converted";
    case "booked":         return "booked";
    case "qualified":      return "qualified";
    case "not_interested": return "not_interested";
    case "no_answer":
    case "voicemail":
      // No answer becomes retry_queue while attempts remain (<3), else no_answer.
      return s.callAttempts > 0 && s.callAttempts < 3 ? "retry_queue" : "no_answer";
    case "called":
    case "contacted":      return "called";
    case "new":
    default:
      // A brand-new lead that's already had a call attempt is "called".
      return s.callAttempts > 0 ? "called" : "new";
  }
}

/** True if the cell is a main funnel stage (vs a sub-state detour). */
export function isMainStage(cell: PipelineCell): cell is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(cell);
}
