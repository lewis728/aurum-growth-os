/**
 * src/lib/services/alertService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Human-in-the-loop failover. When an AI employee hits something a human needs to
 * see — a client at risk, a spend decision awaiting approval, Meta delivery down —
 * we push a plain-English alert to the agency owner's Slack.
 *
 * Design:
 *   - notifySlack()      raw POST to a webhook. NEVER THROWS — an alerting failure
 *                        must never break the agent loop that triggered it.
 *   - sendAgencyAlert()  looks up the tenant's webhook and posts if configured.
 *   - maybeAlertForAction() the single hook the action loggers call after writing
 *                        an AgentAction. It decides (by actionType) whether the
 *                        action warrants a human and formats the message.
 *
 * Alerting is therefore a property of LOGGING AN ACTION: any role that records an
 * alert-worthy AgentAction automatically escalates, with no per-call-site logic.
 */

import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/utils/withRetry";

// ── Which action types escalate to a human ──────────────────────────────────────
// Kept deliberately tight: only genuine "a human should look now" moments, so the
// owner's Slack stays signal, not noise. Routine actions (NO_ACTION, SCALE_BUDGET
// executed within limits, CALL_INITIATED) never alert.
const ALERT_WORTHY_ACTIONS: ReadonlySet<string> = new Set([
  "CLIENT_AT_RISK",     // chief of staff flagged churn risk
  "NEEDS_APPROVAL",     // a spend change is blocked awaiting the owner
  "META_UNAVAILABLE",   // campaign delivery/insights can't be reached
  "CALL_FAILURE_SPIKE", // >50% of recent calls failed (raised by the caller role)
  "CPL_CRITICAL",       // CPL exceeded 3x the vertical benchmark
  "LEAD_DROUGHT",       // zero leads for 6h+ in business hours on a live budget
  "CLIENT_COMPLAINT",   // the agency's client sent a complaint (communicator role)
]);

export function isAlertWorthy(actionType: string): boolean {
  return ALERT_WORTHY_ACTIONS.has(actionType);
}

export interface AgencyAlert {
  agentName:    string;
  clientName:   string;
  actionType:   string;
  issue:        string;        // plain-English description of what's wrong
  tried?:       string;        // what the agent already did
  recommended?: string;        // recommended human action
  blueprintId?: string | null; // deep-link target (null = portfolio-level)
}

const APP_BASE_URL =
  (process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://aurum-growth-os.vercel.app").replace(/\/$/, "");

const ACTION_EMOJI: Record<string, string> = {
  CLIENT_AT_RISK:     "🔴",
  NEEDS_APPROVAL:     "✋",
  META_UNAVAILABLE:   "⚠️",
  CALL_FAILURE_SPIKE: "📵",
  CPL_CRITICAL:       "📈",
  LEAD_DROUGHT:       "🏜️",
  CLIENT_COMPLAINT:   "💢",
};

/**
 * POSTs a Slack message to an Incoming Webhook URL. NEVER THROWS.
 * Returns true if Slack accepted it (HTTP 200), false otherwise.
 */
export async function notifySlack(webhookUrl: string, alert: AgencyAlert): Promise<boolean> {
  if (!webhookUrl || !/^https:\/\/hooks\.slack\.com\//.test(webhookUrl)) {
    console.warn("[alertService] invalid or missing Slack webhook URL — skipping");
    return false;
  }

  const emoji = ACTION_EMOJI[alert.actionType] ?? "🔔";
  const link = alert.blueprintId
    ? `${APP_BASE_URL}/overview`
    : `${APP_BASE_URL}/overview`;

  // Slack Block Kit — readable, scannable, deep-links to God Mode.
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${alert.clientName}* — ${alert.actionType.replace(/_/g, " ").toLowerCase()}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${alert.agentName} says:* ${alert.issue}` },
    },
  ];
  if (alert.tried) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Already tried:* ${alert.tried}` } });
  }
  if (alert.recommended) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Recommended:* ${alert.recommended}` } });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `<${link}|Open dashboard →>` }],
  });

  const fallbackText = `${emoji} ${alert.clientName}: ${alert.issue}`;

  try {
    return await withRetry(
      async () => {
        const res = await fetch(webhookUrl, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ text: fallbackText, blocks }),
        });
        // Slack returns 200 "ok" on success; 4xx (e.g. 404 revoked webhook) must
        // NOT be retried — surface as false without throwing past withRetry.
        if (res.status >= 400 && res.status < 500) {
          console.warn(`[alertService] Slack rejected webhook (HTTP ${res.status}) — not retrying`);
          return false;
        }
        if (!res.ok) throw new Error(`Slack webhook HTTP ${res.status}`);
        return true;
      },
      { maxAttempts: 3, baseDelayMs: 500, label: "alertService.notifySlack" },
    );
  } catch (err) {
    console.error("[alertService] notifySlack failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Looks up the tenant's configured Slack webhook and sends the alert.
 * No-op (returns false) if the agency hasn't configured one. NEVER THROWS.
 */
export async function sendAgencyAlert(tenantId: string, alert: AgencyAlert): Promise<boolean> {
  try {
    const agency = await prisma.agencyProfile.findUnique({
      where:  { tenantId },
      select: { slackWebhookUrl: true },
    });
    const url = agency?.slackWebhookUrl;
    if (!url) return false;
    return await notifySlack(url, alert);
  } catch (err) {
    console.error("[alertService] sendAgencyAlert failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * The single hook the action loggers call right after persisting an AgentAction.
 * Escalates only alert-worthy action types. NEVER THROWS — fire-and-forget safe.
 *
 * @param clientName resolved business name (callers usually have it already; left
 *                   required so we never issue an extra query per logged action).
 */
export async function maybeAlertForAction(opts: {
  tenantId:    string;
  blueprintId: string | null;
  clientName:  string;
  agentName:   string;
  actionType:  string;
  reasoning:   string;
  outcome:     string;
}): Promise<void> {
  if (!isAlertWorthy(opts.actionType)) return;
  try {
    await sendAgencyAlert(opts.tenantId, {
      agentName:    opts.agentName,
      clientName:   opts.clientName,
      actionType:   opts.actionType,
      issue:        opts.reasoning,
      recommended:  opts.outcome,
      blueprintId:  opts.blueprintId,
    });
  } catch (err) {
    console.error("[alertService] maybeAlertForAction failed:", err instanceof Error ? err.message : err);
  }
}
