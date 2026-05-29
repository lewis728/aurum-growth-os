// ─── types/lead.ts ────────────────────────────────────────────────
// Lead type definitions for Aurum Growth OS.
// LeadStatus is a sealed type union — do not add values without updating
// the Prisma schema and all downstream status-gate logic.

export type LeadStatus =
  | "new"
  | "called"
  | "qualified"
  | "no_answer"
  | "booked"
  | "attended"
  | "lost";
