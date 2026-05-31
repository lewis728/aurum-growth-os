/**
 * GET /api/clients/[blueprintId]/team
 *
 * The client's 5-person AI team (Sprint 3C). Each role's "last action" is derived
 * from its REAL signal source, not a brittle agentName match:
 *   Caller     → latest CALL_* AgentAction
 *   Scheduler  → latest Appointment created (it owns post-call booking)
 *   MediaBuyer → latest media AgentAction (pause/scale/flag/no-action/meta)
 *   Reporter   → latest briefing (blueprint.lastBriefingAt) or risk/milestone action
 *   Learner    → ClientBrief.learningsUpdatedAt (it writes no AgentAction)
 *
 * Tenant-scoped. Never 500s on a role with no data — that role reads "Standing by".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export interface TeamMember {
  role:       "caller" | "scheduler" | "mediaBuyer" | "reporter" | "learner";
  roleLabel:  string;
  agentName:  string;
  lastAction: string | null;
  lastActiveAt: string | null;
}

const CALLER_ACTIONS = ["CALL_INITIATED", "CALL_FAILED"];
const MEDIA_ACTIONS  = ["PAUSE_CAMPAIGN", "SCALE_BUDGET", "FLAG_LOW_CTR", "NO_ACTION", "RECOMMEND_CREATIVE_REFRESH", "META_UNAVAILABLE", "NO_META_CAMPAIGN", "NEEDS_APPROVAL"];
const REPORTER_ACTIONS = ["CLIENT_AT_RISK", "MILESTONE"];

export async function GET(
  _req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;
  const blueprintId = params.blueprintId;

  try {
    const [rep, blueprint, brief, callerA, mediaA, reporterA, lastAppt] = await Promise.all([
      prisma.aIRepresentative.findUnique({ where: { blueprintId }, select: { repName: true } }),
      prisma.campaignBlueprint.findFirst({ where: { id: blueprintId, tenantId }, select: { lastBriefingText: true, lastBriefingAt: true } }),
      prisma.clientBrief.findUnique({ where: { blueprintId }, select: { learningsUpdatedAt: true } }),
      prisma.agentAction.findFirst({ where: { blueprintId, tenantId, actionType: { in: CALLER_ACTIONS } }, orderBy: { executedAt: "desc" }, select: { reasoning: true, executedAt: true } }),
      prisma.agentAction.findFirst({ where: { blueprintId, tenantId, actionType: { in: MEDIA_ACTIONS } }, orderBy: { executedAt: "desc" }, select: { reasoning: true, executedAt: true } }),
      prisma.agentAction.findFirst({ where: { blueprintId, tenantId, actionType: { in: REPORTER_ACTIONS } }, orderBy: { executedAt: "desc" }, select: { reasoning: true, executedAt: true } }),
      prisma.appointment.findFirst({ where: { blueprintId, tenantId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, scheduledAt: true } }),
    ]);

    const callerName = rep?.repName ?? "Sophie";

    // Reporter: prefer the most recent of briefing vs risk/milestone action.
    let reporterAction: string | null = null;
    let reporterAt: Date | null = null;
    if (blueprint?.lastBriefingAt) { reporterAction = "Filed the morning briefing."; reporterAt = blueprint.lastBriefingAt; }
    if (reporterA && (!reporterAt || reporterA.executedAt > reporterAt)) {
      reporterAction = reporterA.reasoning; reporterAt = reporterA.executedAt;
    }

    const team: TeamMember[] = [
      {
        role: "caller", roleLabel: "The Caller", agentName: callerName,
        lastAction: callerA?.reasoning ?? null,
        lastActiveAt: callerA?.executedAt.toISOString() ?? null,
      },
      {
        role: "scheduler", roleLabel: "The Scheduler", agentName: "James",
        lastAction: lastAppt ? "Booked an appointment and set up reminders." : null,
        lastActiveAt: lastAppt?.createdAt.toISOString() ?? null,
      },
      {
        role: "mediaBuyer", roleLabel: "The Media Buyer", agentName: "Marcus",
        lastAction: mediaA?.reasoning ?? null,
        lastActiveAt: mediaA?.executedAt.toISOString() ?? null,
      },
      {
        role: "reporter", roleLabel: "The Reporter", agentName: "Ava",
        lastAction: reporterAction,
        lastActiveAt: reporterAt?.toISOString() ?? null,
      },
      {
        role: "learner", roleLabel: "The Learner", agentName: "Kai",
        lastAction: brief?.learningsUpdatedAt ? "Distilled last night's learnings." : null,
        lastActiveAt: brief?.learningsUpdatedAt?.toISOString() ?? null,
      },
    ];

    return NextResponse.json({ team });
  } catch (err) {
    console.error("[team route] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ team: [] });
  }
}
