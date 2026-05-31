/**
 * src/lib/services/speedToLeadService.ts
 * SERVER-SIDE ONLY.
 *
 * The product's core moment: Sophie calls every new lead within 60 seconds.
 * Shared by the lead webhook (immediate) and the reminders cron (retry).
 *
 * Also houses lead intent scoring (Sprint 11) so the webhook and any future
 * caller compute scores identically.
 */

import { prisma } from "@/lib/prisma";
import { createPhoneCall, toE164 } from "@/lib/services/retellService";
import { buildClientContext } from "@/lib/agents/clientContext";
import { CampaignStatus } from "@/enums/campaignEnums";

// Retell dynamic variables must all be strings. Renders the brief's
// objectionResponses (stored as Json — array of {objection,response} or a
// flat map) into a compact, voice-agent-readable string.
function renderObjectionsForCall(raw: unknown): string {
  if (!raw) return "";
  try {
    if (Array.isArray(raw)) {
      return raw
        .map((o) => {
          if (o && typeof o === "object") {
            const { objection, response } = o as { objection?: string; response?: string };
            if (objection && response) return `If they say "${objection}": ${response}`;
          }
          return null;
        })
        .filter((x): x is string => x !== null)
        .join(" | ");
    }
    if (typeof raw === "object") {
      return Object.entries(raw as Record<string, unknown>)
        .map(([k, v]) => (typeof v === "string" ? `If they say "${k}": ${v}` : null))
        .filter((x): x is string => x !== null)
        .join(" | ");
    }
  } catch {
    /* ignore malformed */
  }
  return "";
}

export interface SpeedToLeadLead {
  id:        string;
  firstName: string;
  lastName:  string;
  phone:     string;
}

// ── Lead intent scoring (1-10) ──────────────────────────────────────────────
// Heuristic: faster form fills, business hours, and weekdays signal higher
// intent. Landing pages may include `fillDurationMs` in formData.
export function computeLeadScore(opts: {
  at?:       Date;
  formData?: Record<string, unknown> | null;
}): number {
  const now = opts.at ?? new Date();
  let score = 5;

  const hour = now.getHours();
  if (hour >= 9 && hour < 18) score += 2;
  else if (hour >= 6 && hour < 22) score += 1;
  else score -= 1;

  const day = now.getDay(); // 0 Sun .. 6 Sat
  if (day >= 1 && day <= 5) score += 1;

  const fillMs =
    opts.formData && typeof opts.formData["fillDurationMs"] === "number"
      ? (opts.formData["fillDurationMs"] as number)
      : null;
  if (fillMs != null) {
    if (fillMs < 30_000) score += 2;        // <30s — high intent
    else if (fillMs > 180_000) score -= 1;  // >3min — low intent
  }

  return Math.max(1, Math.min(10, score));
}

// ── Speed-to-lead call placement ────────────────────────────────────────────
// Never throws. Records every outcome as an AgentAction so the agency owner
// sees it in the live feed. Increments callAttempts on every placement so the
// retry path can bound itself.
export async function placeSpeedToLeadCall(opts: {
  blueprintId: string;
  tenantId:    string;
  lead:        SpeedToLeadLead;
  isRetry?:    boolean;
}): Promise<void> {
  const { blueprintId, tenantId, lead, isRetry = false } = opts;

  const blueprint = await prisma.campaignBlueprint.findUnique({
    where:  { id: blueprintId },
    select: { status: true, businessName: true, vertical: true, offerHook: true, voice: true },
  });
  if (!blueprint) return;

  // Only call for live campaigns.
  if (blueprint.status !== CampaignStatus.LIVE) return;

  const rep = await prisma.aIRepresentative.findUnique({
    where:  { blueprintId },
    select: { repName: true },
  });
  const agentName = rep?.repName ?? "Sophie";

  const logAction = (actionType: string, reasoning: string, outcome: string) =>
    prisma.agentAction
      .create({ data: { tenantId, blueprintId, agentName, actionType, reasoning, outcome } })
      .catch((e: unknown) => console.error("[speedToLead] AgentAction log failed:", e));

  // Count the attempt up-front so a hard failure still bounds the retry loop.
  await prisma.lead
    .update({ where: { id: lead.id }, data: { callAttempts: { increment: 1 } } })
    .catch((e: unknown) => console.error("[speedToLead] callAttempts increment failed:", e));

  try {
    const fromNumber = process.env.RETELL_FROM_NUMBER;
    const agentId =
      (blueprint.voice as { retellAgentId?: string } | null)?.retellAgentId ||
      process.env.RETELL_AGENT_ID;

    if (!fromNumber || !agentId) {
      await logAction(
        "CALL_FAILED",
        `Could not call ${lead.firstName} ${lead.lastName}: Retell is not configured (missing ${!fromNumber ? "from number" : "agent id"}).`,
        "Call skipped — Retell not configured"
      );
      return;
    }

    const toNumber = toE164(lead.phone);
    if (!toNumber) {
      await logAction(
        "CALL_FAILED",
        `Could not call ${lead.firstName} ${lead.lastName}: phone number "${lead.phone}" is not a valid number.`,
        "Call skipped — invalid phone number"
      );
      return;
    }

    // Inject the client brief into the call so the SDR is fully briefed on the
    // phone — ideal customer, qualification questions, and objection handling.
    // buildClientContext never throws; brief may be null for un-briefed clients.
    const context = await buildClientContext(blueprintId);
    const brief   = context.brief;

    const { callId } = await createPhoneCall({
      fromNumber,
      toNumber,
      agentId,
      dynamicVariables: {
        lead_first_name:        lead.firstName,
        business_name:          blueprint.businessName,
        vertical:               blueprint.vertical,
        agent_name:             agentName,
        service_description:    blueprint.offerHook ?? "",
        ideal_customer:         brief?.idealCustomerProfile ?? "",
        ideal_customer_profile: brief?.idealCustomerProfile ?? "",
        qualification_questions: brief?.qualificationQuestions ?? "",
        objection_responses:    renderObjectionsForCall(brief?.objectionResponses),
      },
    });

    // Stamp lastContactAt so the phantom call-back loop (Sprint 10C) can time
    // re-engagement from the moment of first contact.
    await prisma.lead.update({ where: { id: lead.id }, data: { retellCallId: callId, lastContactAt: new Date() } });
    await logAction(
      "CALL_INITIATED",
      isRetry
        ? `Retried ${lead.firstName} ${lead.lastName} — no answer on the previous attempt.`
        : `Called ${lead.firstName} ${lead.lastName} within 60 seconds of form submission.`,
      "Call placed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[speedToLead] call failed:", msg);
    await logAction(
      "CALL_FAILED",
      `Tried to call ${lead.firstName} ${lead.lastName} but the call could not be placed: ${msg}`,
      "Call failed"
    );
  }
}
