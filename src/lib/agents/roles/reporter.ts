/**
 * src/lib/agents/roles/reporter.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── THE REPORTER ("Ava") ────────────────────────────────────────────────────
 * The 4th specialist role (caller · scheduler · mediaBuyer · reporter · learner).
 * See roles/caller.ts for the shared role contract.
 *
 * AVA'S JOB: communicate what's happening — to the agency owner and (later) the
 * client. She reads what every OTHER role did (their AgentActions) and turns it
 * into:
 *   1. the daily first-person morning briefing (the proven engine in
 *      morningBriefingService — migrated here as the role's reporting surface)
 *   2. at-risk detection → CLIENT_AT_RISK action (auto-escalates to Slack)
 *   3. milestone messages (10/25/50/100 bookings, etc.) → MILESTONE action
 *
 * DB-only handoff: Ava reads rows the other roles wrote and writes her own rows.
 * She never calls another role. NEVER THROWS.
 *
 * SCOPE NOTE: the weekly client WhatsApp and monthly client report are owned
 * elsewhere — WhatsApp needs twilioService.sendWhatsApp (Sprint 10), and the
 * monthly report already has its own generator + cron (Sprint 5). Ava does not
 * duplicate them; she focuses on owner-facing reporting + risk/milestone signals.
 */

import { prisma } from "@/lib/prisma";
import { generateMorningBriefing } from "@/lib/services/morningBriefingService";
import { maybeAlertForAction } from "@/lib/services/alertService";
import { safeWhatsApp } from "@/lib/services/twilioService";

const REPORTER_NAME = "Ava";
const DAY_MS = 24 * 60 * 60 * 1000;
const BOOKING_MILESTONES = [10, 25, 50, 100, 250, 500];
// Don't re-flag a client at risk more than once every 3 days.
const AT_RISK_COOLDOWN_MS = 3 * DAY_MS;

export interface ReporterResult {
  blueprintId: string;
  briefing:    boolean;     // morning briefing generated?
  atRisk:      boolean;     // CLIENT_AT_RISK raised this cycle?
  milestone:   number | null; // booking milestone crossed this cycle (or null)
}

/**
 * Detects whether the client crossed a booking milestone in the last 24h.
 * Returns the milestone number if newly crossed, else null.
 */
async function detectBookingMilestone(blueprintId: string, tenantId: string): Promise<number | null> {
  const totalNow = await prisma.appointment.count({ where: { blueprintId, tenantId } });
  if (totalNow === 0) return null;
  const since = new Date(Date.now() - DAY_MS);
  const newInWindow = await prisma.appointment.count({
    where: { blueprintId, tenantId, createdAt: { gte: since } },
  });
  const totalBefore = totalNow - newInWindow;
  // A milestone is "crossed" if total now is ≥ M but it wasn't 24h ago.
  for (const m of BOOKING_MILESTONES) {
    if (totalNow >= m && totalBefore < m) return m;
  }
  return null;
}

/**
 * Detects churn-risk signals computable WITHOUT Meta. Returns the list of
 * warning signals currently firing. (CPL-spike / show-rate signals that need
 * Meta breakdown data are added when Marcus's data lands — noted, not faked.)
 */
async function detectRiskSignals(blueprintId: string, tenantId: string): Promise<string[]> {
  const now = Date.now();
  const signals: string[] = [];

  const [last48h, thisWeek, lastWeek, recentAppts] = await Promise.all([
    prisma.lead.count({ where: { blueprintId, tenantId, createdAt: { gte: new Date(now - 2 * DAY_MS) } } }),
    prisma.lead.count({ where: { blueprintId, tenantId, createdAt: { gte: new Date(now - 7 * DAY_MS) } } }),
    prisma.lead.count({ where: { blueprintId, tenantId, createdAt: { gte: new Date(now - 14 * DAY_MS), lt: new Date(now - 7 * DAY_MS) } } }),
    prisma.appointment.findMany({
      where:  { blueprintId, tenantId, scheduledAt: { gte: new Date(now - 14 * DAY_MS), lt: new Date(now) } },
      select: { status: true },
    }),
  ]);

  // Signal 1: no leads in 48h on a live campaign.
  if (last48h === 0) signals.push("No new leads in the last 48 hours.");

  // Signal 2: lead volume down 40%+ week-on-week (needs a real prior baseline).
  if (lastWeek >= 5 && thisWeek < lastWeek * 0.6) {
    const dropPct = Math.round((1 - thisWeek / lastWeek) * 100);
    signals.push(`Lead volume down ${dropPct}% week-on-week (${lastWeek} → ${thisWeek}).`);
  }

  // Signal 3: show rate below 40% over the last 2 weeks (needs ≥4 past appts).
  if (recentAppts.length >= 4) {
    const attended = recentAppts.filter((a) => a.status === "attended").length;
    const showRate = attended / recentAppts.length;
    if (showRate < 0.4) {
      signals.push(`Show rate at ${Math.round(showRate * 100)}% over the last two weeks (${attended}/${recentAppts.length}).`);
    }
  }

  return signals;
}

/**
 * Runs one reporter cycle for a single client. NEVER THROWS.
 * Order: read other roles' work (via the briefing's data gather + risk/milestone
 * queries) → generate briefing → raise at-risk → log milestone.
 */
export async function runReporterCycle(
  blueprintId: string,
  tenantId: string,
): Promise<ReporterResult> {
  const result: ReporterResult = { blueprintId, briefing: false, atRisk: false, milestone: null };

  // ── 1. Morning briefing (the migrated reporting engine) ────────────────────
  try {
    const text = await generateMorningBriefing(blueprintId, tenantId);
    result.briefing = text !== null;
  } catch (err) {
    console.error(`[reporter] briefing failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
  }

  // Client name for alert/milestone copy.
  const blueprint = await prisma.campaignBlueprint
    .findFirst({ where: { id: blueprintId, tenantId }, select: { businessName: true } })
    .catch(() => null);
  const businessName = blueprint?.businessName ?? "this client";

  // ── 2. At-risk detection → CLIENT_AT_RISK (auto-escalates to Slack) ─────────
  try {
    const signals = await detectRiskSignals(blueprintId, tenantId);
    if (signals.length >= 2) {
      // Cooldown: skip if we already flagged this client recently.
      const recentFlag = await prisma.agentAction.findFirst({
        where: {
          blueprintId, tenantId, actionType: "CLIENT_AT_RISK",
          executedAt: { gte: new Date(Date.now() - AT_RISK_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (!recentFlag) {
        const reasoning = `${businessName} is showing ${signals.length} warning signals: ${signals.join(" ")}`;
        const outcome = "Review this client — campaign may need intervention.";
        await prisma.agentAction.create({
          data: { tenantId, blueprintId, agentName: REPORTER_NAME, actionType: "CLIENT_AT_RISK", reasoning, outcome },
        });
        void maybeAlertForAction({
          tenantId, blueprintId, clientName: businessName,
          agentName: REPORTER_NAME, actionType: "CLIENT_AT_RISK", reasoning, outcome,
        });
        result.atRisk = true;
      }
    }
  } catch (err) {
    console.error(`[reporter] at-risk detection failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
  }

  // ── 3. Milestone detection → MILESTONE action ──────────────────────────────
  try {
    const milestone = await detectBookingMilestone(blueprintId, tenantId);
    if (milestone !== null) {
      await prisma.agentAction.create({
        data: {
          tenantId, blueprintId, agentName: REPORTER_NAME,
          actionType: "MILESTONE",
          reasoning:  `${businessName} just hit ${milestone} total booked appointments — the campaign is delivering.`,
          outcome:    `${milestone} bookings reached`,
        },
      });
      result.milestone = milestone;

      // Event-triggered WhatsApp to the client (if a number is on file).
      const brief = await prisma.clientBrief
        .findUnique({ where: { blueprintId }, select: { clientWhatsApp: true, clientContactName: true } })
        .catch(() => null);
      const wa = brief?.clientWhatsApp?.trim();
      if (wa) {
        const name = brief?.clientContactName?.trim() || "there";
        const sid = await safeWhatsApp(
          wa,
          `Hi ${name} — great news: we've now booked ${milestone} appointments for ${businessName}. The campaign's working well and we'll keep it going.`,
        );
        if (sid) {
          await prisma.clientMessage.create({
            data: {
              tenantId, blueprintId, direction: "outbound", channel: "whatsapp",
              intent: "praise", content: `Milestone: ${milestone} bookings`, sentAt: new Date(),
            },
          }).catch(() => { /* non-fatal */ });
        }
      }
    }
  } catch (err) {
    console.error(`[reporter] milestone detection failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
  }

  return result;
}
