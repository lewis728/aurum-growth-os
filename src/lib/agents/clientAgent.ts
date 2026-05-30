/**
 * src/lib/agents/clientAgent.ts
 * SERVER-SIDE ONLY.
 *
 * The Client Account-Manager agent — a dedicated agent per client (blueprint).
 * It manages ONE client's advertising: it reads that client's full context
 * (business basics + ClientBrief, via the Client Context Engine) at the start of
 * every cycle and runs the autonomous Meta reasoning loop within the brief's
 * guardrails (budget hard limit, approval threshold, target CPL).
 *
 * Scope: blueprintId only. It never reads another client's data.
 * Persona: "{agentName}, a dedicated account manager for {businessName}."
 *
 * The Meta decision tree lives in agentReasoningService.runAgentReasoningCycle
 * (the shared engine); this module owns context-fetching + guardrail injection so
 * the engine and the chat surface stay in sync.
 */
import {
  runAgentReasoningCycle,
  type ClientBriefGuardrails,
} from "@/lib/services/agentReasoningService";
import { buildClientContext } from "@/lib/agents/clientContext";

/**
 * The Client Agent persona line. Shared by the reasoning loop + client chat.
 */
export function clientAgentPersona(agentName: string, businessName: string): string {
  return (
    `You are ${agentName}, a dedicated account manager for ${businessName}. ` +
    `You manage their advertising, call their leads, and report back to the agency owner. ` +
    `You know only about this client.`
  );
}

/**
 * Runs one reasoning cycle for a single client, scoped to blueprintId.
 * Pulls the full client context, derives guardrails, and delegates to the shared
 * Meta decision engine. Never throws — failures are logged.
 */
export async function runClientAgentCycle(
  blueprintId: string,
  tenantId: string
): Promise<void> {
  try {
    const context = await buildClientContext(blueprintId);

    const guardrails: ClientBriefGuardrails = {
      budgetHardLimitGbp:   context.guardrails.budgetHardLimitGbp,
      approvalThresholdGbp: context.guardrails.approvalThresholdGbp,
      briefText:            context.promptBlock,
    };

    await runAgentReasoningCycle(blueprintId, tenantId, guardrails);
  } catch (err) {
    console.error(
      `[clientAgent] cycle failed for blueprint ${blueprintId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
