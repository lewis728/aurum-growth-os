/**
 * src/lib/agents/clientContext.ts
 * SERVER-SIDE ONLY.
 *
 * The Client Context Engine — the single source of "what the agent knows about
 * this client". It assembles everything from one place so every agent surface
 * (reasoning loop, client chat, morning briefing, creative generation) injects
 * the SAME context and the agent behaves consistently.
 *
 * Knowledge domains (see also ClientBrief):
 *   1. Business & offer (incl. average client value → ROI reasoning)
 *   2. Customer (ideal profile, good/bad lead signals)
 *   3. Voice & guardrails (brand tone, compliance/do-not-say)
 *   4. The sale (qualification, objections, business hours)
 *   5. The numbers (target CPL, budget, hard limit, approval threshold)
 *   6. Competition & market
 *
 * Scope: a single blueprintId. Never reads another client's data.
 */
import { prisma } from "@/lib/prisma";
import type { ClientBrief } from "@prisma/client";

export interface ClientContext {
  blueprintId:  string;
  businessName: string;
  vertical:     string;
  agentName:    string;
  brief:        ClientBrief | null;
  /** Fully-assembled system-prompt block the agent injects. */
  promptBlock:  string;
  /** Guardrails surfaced for the reasoning loop. */
  guardrails: {
    budgetHardLimitGbp:   number | null;
    approvalThresholdGbp: number | null;
    targetCplGbp:         number | null;
  };
}

function line(label: string, value: string | null | undefined): string | null {
  const v = value?.toString().trim();
  return v ? `${label}: ${v}` : null;
}

/**
 * Renders objectionResponses (stored as Json) into readable lines. Accepts either
 * an array of {objection,response} or a flat {objection: response} map.
 */
function renderObjections(raw: unknown): string | null {
  if (!raw) return null;
  try {
    if (Array.isArray(raw)) {
      const items = raw
        .map((o) => {
          if (o && typeof o === "object") {
            const obj = o as { objection?: string; response?: string };
            if (obj.objection && obj.response) return `  - "${obj.objection}" → ${obj.response}`;
          }
          return null;
        })
        .filter((x): x is string => x !== null);
      return items.length ? items.join("\n") : null;
    }
    if (typeof raw === "object") {
      const items = Object.entries(raw as Record<string, unknown>)
        .map(([k, v]) => (typeof v === "string" ? `  - "${k}" → ${v}` : null))
        .filter((x): x is string => x !== null);
      return items.length ? items.join("\n") : null;
    }
  } catch {
    /* ignore malformed */
  }
  return null;
}

/**
 * Builds the brief block. Exported separately so callers that already hold a
 * brief (e.g. seeding) can render without a DB round-trip.
 */
export function renderBriefBlock(brief: ClientBrief | null): string {
  if (!brief) {
    return "YOUR BRIEF FOR THIS CLIENT:\n(No detailed brief on file yet — ask the agency owner to complete it for sharper targeting.)";
  }

  const objections = renderObjections(brief.objectionResponses);

  const parts: (string | null)[] = [
    "YOUR BRIEF FOR THIS CLIENT:",
    line("Ideal customer", brief.idealCustomerProfile),
    line("Bad leads (do NOT optimise toward these)", brief.badLeadSignals),
    line("Brand tone", brief.brandTone),
    line("Key USPs", brief.keyUSPs),
    line("Competitors", brief.competitorNames),
    brief.averageClientValue != null ? `Average client value: £${brief.averageClientValue} — reason in ROI, not just CPL` : null,
    brief.targetCplGbp != null ? `Target CPL: £${brief.targetCplGbp}` : null,
    brief.budgetHardLimit != null ? `Budget hard limit: £${brief.budgetHardLimit}/day — never exceed without approval` : null,
    brief.approvalThreshold != null ? `Approval threshold: £${brief.approvalThreshold} — changes above this need agency owner approval` : null,
    line("Qualification questions", brief.qualificationQuestions),
    objections ? `Objection responses:\n${objections}` : null,
    line("COMPLIANCE — never claim/say", brief.complianceNotes),
    line("Website summary", brief.websiteSummary),
    // Kai's nightly distillation — what we've LEARNED about this specific client.
    // Surfaced to every role so the whole team compounds knowledge over time.
    brief.distilledLearnings
      ? `WHAT WE'VE LEARNED ABOUT THIS CLIENT (updated nightly by Kai — act on these):\n${brief.distilledLearnings}`
      : null,
  ];

  return parts.filter((p): p is string => p !== null).join("\n");
}

/**
 * Assembles the full client context for a blueprint. The single function every
 * agent surface should call. Never throws — returns a minimal context on error.
 */
export async function buildClientContext(blueprintId: string): Promise<ClientContext> {
  const fallback = (
    businessName = "this client",
    vertical = "general",
    agentName = "Your Agent",
    brief: ClientBrief | null = null
  ): ClientContext => ({
    blueprintId,
    businessName,
    vertical,
    agentName,
    brief,
    promptBlock: renderBriefBlock(brief),
    guardrails: {
      budgetHardLimitGbp:   brief?.budgetHardLimit ?? null,
      approvalThresholdGbp: brief?.approvalThreshold ?? null,
      targetCplGbp:         brief?.targetCplGbp ?? null,
    },
  });

  try {
    const [blueprint, rep, brief] = await Promise.all([
      prisma.campaignBlueprint.findUnique({
        where:  { id: blueprintId },
        select: { businessName: true, vertical: true, offerHook: true, targetLocation: true, businessDescription: true },
      }),
      prisma.aIRepresentative.findUnique({ where: { blueprintId }, select: { repName: true } }),
      prisma.clientBrief.findUnique({ where: { blueprintId } }),
    ]);

    if (!blueprint) return fallback();

    const agentName = rep?.repName ?? "Your Agent";

    // Business basics always available even before a brief is filled.
    const basics = [
      `Business: ${blueprint.businessName}`,
      line("Vertical", blueprint.vertical),
      line("Location", blueprint.targetLocation),
      line("Offer", blueprint.offerHook ?? blueprint.businessDescription),
    ].filter((p): p is string => p !== null).join("\n");

    const promptBlock = `${basics}\n\n${renderBriefBlock(brief)}`;

    return {
      blueprintId,
      businessName: blueprint.businessName,
      vertical:     blueprint.vertical,
      agentName,
      brief,
      promptBlock,
      guardrails: {
        budgetHardLimitGbp:   brief?.budgetHardLimit ?? null,
        approvalThresholdGbp: brief?.approvalThreshold ?? null,
        targetCplGbp:         brief?.targetCplGbp ?? null,
      },
    };
  } catch (err) {
    console.error(`[clientContext] build failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return fallback();
  }
}
