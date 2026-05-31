/**
 * GET /api/dashboard/overview
 * God Mode — the agency owner's command centre. One tenant-scoped call returns:
 *   - top-strip aggregates (leads today, booked today, est. revenue this month, active campaigns)
 *   - a per-client portfolio row (status, agent, leads today, booked today,
 *     est. revenue this month, last agent action)
 *   - flagged clients (latest CLIENT_AT_RISK action per client)
 *   - the Chief of Staff's most recent portfolio briefing (if any)
 *
 * Never throws — returns an empty shape on error so the dashboard always renders.
 *
 * Honesty note: CPL-vs-benchmark is intentionally omitted. It needs Meta spend,
 * which isn't connected yet — we surface what we can verify rather than fabricate.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface LastAction {
  actionType: string;
  reasoning:  string;
  agentName:  string;
  executedAt: string;
}
interface PortfolioRow {
  blueprintId:         string;
  businessName:        string;
  agentName:           string | null;
  status:              string;
  leadsToday:          number;
  bookedToday:         number;
  revenueThisMonthGbp: number | null;
  lastAction:          LastAction | null;
}
interface FlaggedClient {
  blueprintId:  string;
  businessName: string;
  reason:       string;
  recommended:  string;
  flaggedAt:    string;
}
interface OverviewResponse {
  topStrip: { leadsToday: number; bookedToday: number; revenueThisMonthGbp: number; activeCampaigns: number; pipelineValueGbp: number };
  briefing: { text: string; generatedAt: string } | null;
  flagged:  FlaggedClient[];
  clients:  PortfolioRow[];
  pendingApprovals: number; // client messages awaiting the owner's sign-off (Sprint 9)
}

const EMPTY: OverviewResponse = {
  topStrip: { leadsToday: 0, bookedToday: 0, revenueThisMonthGbp: 0, activeCampaigns: 0, pipelineValueGbp: 0 },
  briefing: null,
  flagged:  [],
  clients:  [],
  pendingApprovals: 0,
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  try {
    const today = startOfToday();
    const monthStart = startOfMonth();

    // CampaignBlueprint has no `representative` relation — fetch reps separately.
    const blueprints = await prisma.campaignBlueprint.findMany({
      where:   { tenantId },
      orderBy: { createdAt: "desc" },
      select:  { id: true, businessName: true, status: true },
    });
    const blueprintIds = blueprints.map((b) => b.id);

    if (blueprintIds.length === 0) {
      return NextResponse.json(EMPTY);
    }

    const [reps, briefs, leadsTodayRows, bookedTodayRows, bookedMonthRows, openApptRows, riskActions, briefingAction, recentActions] =
      await Promise.all([
        prisma.aIRepresentative.findMany({
          where:  { tenantId, blueprintId: { in: blueprintIds } },
          select: { blueprintId: true, repName: true },
        }),
        prisma.clientBrief.findMany({
          where:  { tenantId },
          select: { blueprintId: true, averageClientValue: true },
        }),
        prisma.lead.groupBy({
          by:     ["blueprintId"],
          where:  { tenantId, createdAt: { gte: today } },
          _count: { _all: true },
        }),
        prisma.appointment.groupBy({
          by:     ["blueprintId"],
          where:  { tenantId, createdAt: { gte: today } },
          _count: { _all: true },
        }),
        prisma.appointment.groupBy({
          by:     ["blueprintId"],
          where:  { tenantId, createdAt: { gte: monthStart } },
          _count: { _all: true },
        }),
        // Open pipeline = unresolved appointments (future/unconfirmed-outcome).
        // Authoritative count from the Appointment table — not the lazily-synced
        // Lead.pipelineStage column — so God Mode value is always accurate.
        prisma.appointment.groupBy({
          by:     ["blueprintId"],
          where:  { tenantId, status: { in: ["confirmed", "scheduled"] } },
          _count: { _all: true },
        }),
        prisma.agentAction.findMany({
          where:   { tenantId, actionType: "CLIENT_AT_RISK" },
          orderBy: { executedAt: "desc" },
          take:    50,
        }),
        prisma.agentAction.findFirst({
          where:   { tenantId, blueprintId: null, actionType: "PORTFOLIO_BRIEFING" },
          orderBy: { executedAt: "desc" },
        }),
        prisma.agentAction.findMany({
          where:   { tenantId, blueprintId: { in: blueprintIds } },
          orderBy: { executedAt: "desc" },
          take:    200,
          select:  { blueprintId: true, actionType: true, reasoning: true, agentName: true, executedAt: true },
        }),
      ]);

    const repByClient    = new Map(reps.map((r) => [r.blueprintId, r.repName]));
    const avgValueByClient = new Map(briefs.map((b) => [b.blueprintId, b.averageClientValue]));
    const leadsToday  = new Map<string | null, number>(leadsTodayRows.map((r) => [r.blueprintId, r._count._all]));
    const bookedToday = new Map<string | null, number>(bookedTodayRows.map((r) => [r.blueprintId, r._count._all]));
    const bookedMonth = new Map<string | null, number>(bookedMonthRows.map((r) => [r.blueprintId, r._count._all]));
    const openAppts   = new Map<string | null, number>(openApptRows.map((r) => [r.blueprintId, r._count._all]));

    // Pipeline value = open appointments × that client's average client value.
    let pipelineValueGbp = 0;
    for (const b of blueprints) {
      const avg = avgValueByClient.get(b.id);
      if (avg != null) pipelineValueGbp += (openAppts.get(b.id) ?? 0) * avg;
    }

    // Last action per blueprint (most recent first → take the first seen).
    const lastActionByClient = new Map<string, LastAction>();
    for (const a of recentActions) {
      if (a.blueprintId && !lastActionByClient.has(a.blueprintId)) {
        lastActionByClient.set(a.blueprintId, {
          actionType: a.actionType,
          reasoning:  a.reasoning,
          agentName:  a.agentName,
          executedAt: a.executedAt.toISOString(),
        });
      }
    }

    const nameById = new Map(blueprints.map((b) => [b.id, b.businessName]));
    const flagged: FlaggedClient[] = [];
    const seenFlag = new Set<string>();
    for (const a of riskActions) {
      if (!a.blueprintId || seenFlag.has(a.blueprintId)) continue;
      seenFlag.add(a.blueprintId);
      flagged.push({
        blueprintId:  a.blueprintId,
        businessName: nameById.get(a.blueprintId) ?? "Unknown client",
        reason:       a.reasoning,
        recommended:  a.outcome,
        flaggedAt:    a.executedAt.toISOString(),
      });
    }

    const clients: PortfolioRow[] = blueprints.map((b) => {
      const avg = avgValueByClient.get(b.id) ?? null;
      const monthBooked = bookedMonth.get(b.id) ?? 0;
      return {
        blueprintId:         b.id,
        businessName:        b.businessName,
        agentName:           repByClient.get(b.id) ?? null,
        status:              b.status,
        leadsToday:          leadsToday.get(b.id) ?? 0,
        bookedToday:         bookedToday.get(b.id) ?? 0,
        revenueThisMonthGbp: avg != null ? Math.round(monthBooked * avg) : null,
        lastAction:          lastActionByClient.get(b.id) ?? null,
      };
    });

    const response: OverviewResponse = {
      topStrip: {
        leadsToday:          Array.from(leadsToday.values()).reduce((s, n) => s + n, 0),
        bookedToday:         Array.from(bookedToday.values()).reduce((s, n) => s + n, 0),
        revenueThisMonthGbp: clients.reduce((s, c) => s + (c.revenueThisMonthGbp ?? 0), 0),
        activeCampaigns:     blueprints.filter((b) => b.status === "live").length,
        pipelineValueGbp:    Math.round(pipelineValueGbp),
      },
      briefing: briefingAction
        ? { text: briefingAction.reasoning, generatedAt: briefingAction.executedAt.toISOString() }
        : null,
      flagged,
      clients,
      pendingApprovals: await prisma.clientMessage.count({
        where: { tenantId, requiresApproval: true },
      }).catch(() => 0),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[dashboard/overview] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(EMPTY);
  }
}
