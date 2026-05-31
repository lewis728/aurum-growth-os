/**
 * src/lib/agents/roles/caller.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── THE CALLER (e.g. "Sophie") ──────────────────────────────────────────────
 * One of the FIVE independent specialist roles that make up a client's AI team:
 *   caller · scheduler · mediaBuyer · reporter · learner
 *
 * SHARED ROLE CONTRACT (every role file obeys this):
 *   1. INDEPENDENT  — a role never imports or calls another role. The only thing
 *                     it shares with the others is the database.
 *   2. DB-ONLY HANDOFF — work is passed to the next role by writing rows
 *                     (Lead, Appointment, AgentAction, ScheduledReminder…), never
 *                     by direct function calls between roles.
 *   3. FAILURE-ISOLATED — a failure inside one role never cascades. Public methods
 *                     either never throw (call-time paths) or throw only to their
 *                     own HTTP caller (deploy path) — never into a sibling role.
 *
 * THE CALLER'S JOB: get deployed for a client, then call every new lead within
 * 60 seconds, qualify against the brief, and book. The outcome is handed to the
 * SCHEDULER purely through the database — the Retell post-call webhook writes the
 * Lead/Appointment rows the Scheduler then acts on. The Caller never invokes the
 * Scheduler directly.
 */

import { provisionClientAgent, type ProvisionResult } from "@/lib/services/agentProvisioning";
import { placeSpeedToLeadCall, type SpeedToLeadLead } from "@/lib/services/speedToLeadService";

export type { ProvisionResult, SpeedToLeadLead };

/**
 * Deploy (or re-deploy) this client's dedicated voice agent — the "Deploy Sophie"
 * moment. Idempotent: re-running updates the existing agent's prompt in place.
 * Throws on failure so the HTTP deploy route can surface it (deploy is a
 * synchronous, owner-initiated action — not a sibling-role handoff).
 */
export async function deployCaller(
  blueprintId: string,
  tenantId: string,
): Promise<ProvisionResult> {
  return provisionClientAgent(blueprintId, tenantId);
}

/**
 * Call a fresh lead within 60 seconds and hand the outcome to the Scheduler via
 * the database (Retell → post-call webhook → Lead/Appointment rows).
 * NEVER THROWS — every outcome is recorded as an AgentAction so a call failure is
 * contained to the Caller and never breaks the lead webhook or a sibling role.
 */
export async function callLead(opts: {
  blueprintId: string;
  tenantId:    string;
  lead:        SpeedToLeadLead;
  isRetry?:    boolean;
}): Promise<void> {
  return placeSpeedToLeadCall(opts);
}
