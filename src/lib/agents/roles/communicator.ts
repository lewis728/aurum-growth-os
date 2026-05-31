/**
 * src/lib/agents/roles/communicator.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── THE COMMUNICATOR ────────────────────────────────────────────────────────
 * A 6th agent (beyond the core 5 specialist roles): handles ALL inbound messages
 * from the agency's CLIENT (the business owner), so the agency owner doesn't have
 * to. It classifies intent, drafts a response from real client data, and routes:
 *
 *   question    → answer from data; auto-send (no spend, no commitment)
 *   praise      → warm acknowledgement; auto-send
 *   instruction → if within the brief's approvalThreshold, act/ack; else hold for
 *                 the agency owner's approval
 *   request     → hold for approval (it's asking the agency to DO something)
 *   complaint   → hold for approval AND fire an immediate Slack alert to the owner
 *
 * "Hold for approval" persists the drafted reply with requiresApproval=true; the
 * owner approves/sends from the client sub-account or the God Mode strip.
 *
 * DB-only: writes ClientMessage rows + (for complaints) an AgentAction that the
 * alert hook escalates. Never calls another role. NEVER THROWS.
 */

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { buildClientContext } from "@/lib/agents/clientContext";
import { maybeAlertForAction } from "@/lib/services/alertService";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const COMMUNICATOR_NAME = "Sophie"; // speaks as the client's named caller/account contact

type Intent = "question" | "instruction" | "complaint" | "praise" | "request";
const INTENTS = new Set<Intent>(["question", "instruction", "complaint", "praise", "request"]);

// Intents whose drafted reply may auto-send without owner approval.
const AUTO_SEND: ReadonlySet<Intent> = new Set<Intent>(["question", "praise"]);

export interface HandleMessageResult {
  inboundId:     string;
  intent:        Intent;
  response:      string;
  autoSent:      boolean;
  requiresApproval: boolean;
}

/**
 * Handles one inbound client message. NEVER THROWS — on any failure it still
 * records the inbound row and returns a safe holding response.
 */
export async function handleClientMessage(opts: {
  blueprintId: string;
  tenantId:    string;
  content:     string;
  channel?:    string;
}): Promise<HandleMessageResult> {
  const { blueprintId, tenantId, content } = opts;
  const channel = opts.channel ?? "dashboard";

  // Always record the inbound message first, so nothing is ever lost.
  const inbound = await prisma.clientMessage.create({
    data: { blueprintId, tenantId, direction: "inbound", channel, content },
  });

  // Safe fallback if GPT/classification fails — hold for a human.
  const holdFallback = async (reason: string): Promise<HandleMessageResult> => {
    await prisma.clientMessage.update({
      where: { id: inbound.id },
      data:  { intent: "request", requiresApproval: true },
    }).catch(() => { /* non-fatal */ });
    return { inboundId: inbound.id, intent: "request", response: reason, autoSent: false, requiresApproval: true };
  };

  try {
    if (!process.env.OPENAI_API_KEY) return holdFallback("Thanks for your message — the team will get back to you shortly.");

    const ctx = await buildClientContext(blueprintId);
    const brief = ctx.brief;
    const approvalThreshold = brief?.approvalThreshold ?? null;

    // Real data so "question" answers are grounded, not vague.
    const [leadsToday, bookedThisWeek, lastAction] = await Promise.all([
      prisma.lead.count({ where: { blueprintId, tenantId, createdAt: { gte: startOfToday() } } }),
      prisma.appointment.count({ where: { blueprintId, tenantId, createdAt: { gte: startOfWeek() } } }),
      prisma.agentAction.findFirst({ where: { blueprintId, tenantId }, orderBy: { executedAt: "desc" }, select: { reasoning: true } }),
    ]);

    const dataBlock =
      `Live data you may use to answer factually:\n` +
      `- New leads today: ${leadsToday}\n` +
      `- Appointments booked this week: ${bookedThisWeek}\n` +
      `- Most recent thing the team did: ${lastAction?.reasoning ?? "nothing logged yet"}`;

    const completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      temperature:     0.4,
      max_tokens:      400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are ${COMMUNICATOR_NAME}, the account contact replying to a message from the client ` +
            `(${ctx.businessName}). Classify the message intent, then draft a warm, concise reply in the ` +
            `client's brand tone. Use the live data for factual questions; never invent numbers. Never ` +
            `mention any technology vendor or that you are automated.\n${ctx.promptBlock}\n\n${dataBlock}\n\n` +
            `Respond ONLY as JSON: {"intent": "question"|"instruction"|"complaint"|"praise"|"request", ` +
            `"response": string}.`,
        },
        { role: "user", content },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { intent?: string; response?: string };
    const intent: Intent = INTENTS.has(parsed.intent as Intent) ? (parsed.intent as Intent) : "request";
    const response = (parsed.response ?? "").trim() || "Thanks for your message — I'll look into this and come back to you.";

    // Decide routing.
    let requiresApproval: boolean;
    if (intent === "complaint" || intent === "request") {
      requiresApproval = true;
    } else if (intent === "instruction") {
      // Instructions auto-act only when there's a threshold and it's effectively
      // a no-cost ack; to stay safe we hold every instruction for approval unless
      // the owner has set NO threshold (meaning they've delegated freely).
      requiresApproval = approvalThreshold !== null;
    } else {
      requiresApproval = !AUTO_SEND.has(intent);
    }

    // Persist intent on the inbound row + the drafted reply.
    await prisma.clientMessage.update({
      where: { id: inbound.id },
      data:  { intent, agentResponse: response, requiresApproval },
    });

    const autoSent = !requiresApproval;
    if (autoSent) {
      // Record the outbound reply as sent.
      await prisma.clientMessage.create({
        data: {
          blueprintId, tenantId, direction: "outbound", channel,
          intent, content: response, sentAt: new Date(),
        },
      });
    }

    // Complaints always escalate to the owner immediately.
    if (intent === "complaint") {
      const reasoning = `Client (${ctx.businessName}) sent a complaint: "${content.slice(0, 200)}"`;
      await prisma.agentAction.create({
        data: { tenantId, blueprintId, agentName: COMMUNICATOR_NAME, actionType: "CLIENT_COMPLAINT", reasoning, outcome: "Drafted reply held for your approval" },
      }).catch(() => { /* non-fatal */ });
      void maybeAlertForAction({
        tenantId, blueprintId, clientName: ctx.businessName,
        agentName: COMMUNICATOR_NAME, actionType: "CLIENT_COMPLAINT", reasoning, outcome: "Reply drafted — review and approve",
      });
    }

    return { inboundId: inbound.id, intent, response, autoSent, requiresApproval };
  } catch (err) {
    console.error(`[communicator] handle failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return holdFallback("Thanks for your message — the team will get back to you shortly.");
  }
}

function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function startOfWeek(): Date {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d;
}
