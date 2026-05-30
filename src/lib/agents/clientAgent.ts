/**
 * src/lib/agents/clientAgent.ts
 * SERVER-SIDE ONLY.
 *
 * The Client Account-Manager agent — a dedicated agent per client (blueprint).
 * It manages ONE client's advertising: it reads that client's ClientBrief at the
 * start of every cycle and runs the autonomous Meta reasoning loop within the
 * brief's guardrails (ideal/bad leads, brand voice, USPs, budget hard limit,
 * approval threshold).
 *
 * Scope: blueprintId only. It never reads another client's data.
 * Persona: "{agentName}, a dedicated account manager for {businessName}."
 *
 * The Meta decision tree itself lives in agentReasoningService.runAgentReasoningCycle
 * (the shared engine); this module owns brief-fetching + guardrail injection so the
 * engine and the chat surface stay in sync.
 */
import { prisma } from "@/lib/prisma";
import {
  runAgentReasoningCycle,
  type ClientBriefGuardrails,
} from "@/lib/services/agentReasoningService";
import type { ClientBrief } from "@prisma/client";

/**
 * Builds the brief-injection block shown to the agent for a client. Used by both
 * the reasoning loop (instruction parsing) and the client chat (system prompt) so
 * the agent behaves identically in both.
 */
export function buildClientBriefInjection(brief: ClientBrief | null): string {
  if (!brief) return "";
  const lines = [
    "YOUR BRIEF FOR THIS CLIENT:",
    `Ideal customer: ${brief.idealCustomerProfile ?? "not specified"}`,
    `Bad leads: ${brief.badLeadSignals ?? "not specified"}`,
    `Brand tone: ${brief.brandTone ?? "not specified"}`,
    `Key USPs: ${brief.keyUSPs ?? "not specified"}`,
  ];
  if (brief.budgetHardLimit != null) {
    lines.push(`Budget hard limit: £${brief.budgetHardLimit}/day — never exceed without approval`);
  }
  if (brief.approvalThreshold != null) {
    lines.push(`Approval threshold: £${brief.approvalThreshold} — changes above this need agency owner approval`);
  }
  return lines.join("\n");
}

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
 * Fetches the ClientBrief, derives guardrails, and delegates to the shared
 * Meta decision engine. Never throws — failures are logged.
 */
export async function runClientAgentCycle(
  blueprintId: string,
  tenantId: string
): Promise<void> {
  try {
    const brief = await prisma.clientBrief.findUnique({
      where: { blueprintId },
    });

    const guardrails: ClientBriefGuardrails = {
      budgetHardLimitGbp:   brief?.budgetHardLimit ?? null,
      approvalThresholdGbp: brief?.approvalThreshold ?? null,
      briefText:            buildClientBriefInjection(brief),
    };

    await runAgentReasoningCycle(blueprintId, tenantId, guardrails);
  } catch (err) {
    console.error(
      `[clientAgent] cycle failed for blueprint ${blueprintId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
