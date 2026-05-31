/**
 * src/lib/agents/clientAgent.ts
 * SERVER-SIDE ONLY.
 *
 * The per-client account manager — the agent that manages ONE client's campaign.
 * This is the "Client Agent" half of the dual-agent architecture (the other half
 * is the Chief of Staff, chiefOfStaff.ts).
 *
 * As of Sprint 7 the reasoning logic lives in the MEDIA BUYER role
 * (roles/mediaBuyer.ts) — the 5-step OBSERVE→DIAGNOSE→DECIDE→ACT→LOG brain.
 * This file is now a thin delegate kept for backward-compatibility (the
 * agent-reasoning cron + any callers still import runClientAgentCycle).
 */

import { runMediaBuyerCycle } from "@/lib/agents/roles/mediaBuyer";

export interface ClientAgentResult {
  blueprintId: string;
  ran:         boolean;
  reason?:     string;
}

/**
 * The Client Agent persona line. Shared by the reasoning loop + client chat.
 * (Retained here — imported by the agent chat route.)
 */
export function clientAgentPersona(agentName: string, businessName: string): string {
  return (
    `You are ${agentName}, a dedicated account manager for ${businessName}. ` +
    `You manage their advertising, call their leads, and report back to the agency owner. ` +
    `You know only about this client.`
  );
}

/**
 * Runs one reasoning cycle for a single client (blueprint) by delegating to the
 * media buyer role. Never throws — runMediaBuyerCycle never throws.
 */
export async function runClientAgentCycle(
  blueprintId: string,
  tenantId: string
): Promise<ClientAgentResult> {
  const result = await runMediaBuyerCycle(blueprintId, tenantId);
  return { blueprintId, ran: true, reason: result.status };
}
