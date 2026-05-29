/**
 * src/app/api/dashboard/metrics/route.ts
 * GET /api/dashboard/metrics
 *
 * Accepts optional ?blueprintId= query param.
 * When provided: filters all queries to that specific blueprint only.
 * When omitted:  aggregates data across ALL tenant blueprints.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma }       from "@prisma/client";
import { getTenantId } from "@/lib/auth";
import { prisma }      from "@/lib/prisma";
import type { CallAnalysis }     from "@/types/voiceLayer";
import type { MediaBuyingLayer } from "@/types/mediaBuyingLayer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HeroMetrics {
  spendToday:     number;
  leadsToday:     number;
  cplThisWeek:    number;
  bookedThisWeek: number;
}

export interface CampaignHealthRow {
  blueprintId:    string;
  displayName:    string;
  vertical:       string;
  status:         string;
  dailyBudgetGbp: number;
  spendToday:     number;
  cplThisWeek:    number;
  ctr:            number;
  leadsThisWeek:  number;
  metaCampaignId: string | null;
}

export interface RecentCallRow {
  leadId:          string;
  leadName:        string;
  clientName:      string;
  outcome:         "booked" | "qualified" | "no_answer" | "not_interested" | "unknown";
  durationSeconds: number;
  completedAt:     string;
}

export interface BookingRow {
  appointmentId: string;
  leadName:      string;
  clientName:    string;
  slotTime:      string;
  status:        string;
  remindersSent: {
    confirmation: boolean;
    dayBefore:    boolean;
    hourBefore:   boolean;
  };
}

export interface SpendChartPoint {
  date:       string;
  spendGbp:   number;
  leadsCount: number;
}

export interface DashboardMetricsResponse {
  heroMetrics:      HeroMetrics;
  campaignHealth:   CampaignHealthRow[];
  recentCalls:      RecentCallRow[];
  upcomingBookings: BookingRow[];
  spendChart:       SpendChartPoint[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const USD_TO_GBP = 1 / 1.27;
function usdToGbp(usd: number): number {
  return Math.round(usd * USD_TO_GBP * 100) / 100;
}

function startOfDayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfWeekUtc(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgoUtc(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getCallOutcome(callAnalysis: unknown): RecentCallRow["outcome"] {
  if (!callAnalysis || typeof callAnalysis !== "object") return "unknown";
  const ca = callAnalysis as Partial<CallAnalysis>;
  if (ca.appointmentBooked) return "booked";
  if (ca.qualifiedLead)     return "qualified";
  if (ca.sentiment === "negative") return "not_interested";
  return "unknown";
}

function getMetaCampaignId(mediaBuying: unknown): string | null {
  if (!mediaBuying || typeof mediaBuying !== "object") return null;
  const mb = mediaBuying as Partial<MediaBuyingLayer>;
  return mb.metaAdIds?.campaignId ?? null;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const blueprintIdFilter = searchParams.get("blueprintId") ?? undefined;

  const todayStart   = startOfDayUtc();
  const weekStart    = startOfWeekUtc();
  const sevenDaysAgo = daysAgoUtc(7);
  const now          = new Date();

  // Blueprints
  const blueprints = await prisma.campaignBlueprint.findMany({
    where: blueprintIdFilter
      ? { id: blueprintIdFilter, tenantId }
      : { tenantId },
    orderBy: { createdAt: "desc" },
  });
  const blueprintIds = blueprints.map((b) => b.id);
  const blueprintNameMap = new Map<string, string>(
    blueprints.map((b) => [b.id, b.businessName])
  );

  // Leads
  const [leadsToday, leadsThisWeek, allLeadsWithCalls, allRecentLeads] =
    await Promise.all([
      prisma.lead.count({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          createdAt: { gte: todayStart },
        },
      }),
      prisma.lead.findMany({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          createdAt: { gte: weekStart },
        },
        select: { id: true, blueprintId: true },
      }),
      prisma.lead.findMany({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          callAnalysis: { not: Prisma.JsonNull },
          updatedAt: { gte: sevenDaysAgo },
        },
        select: {
          id:           true,
          firstName:    true,
          lastName:     true,
          blueprintId:  true,
          callAnalysis: true,
          updatedAt:    true,
        },
        orderBy: { updatedAt: "desc" },
        take:    20,
      }),
      prisma.lead.findMany({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          createdAt: { gte: sevenDaysAgo },
        },
        select: { createdAt: true, blueprintId: true },
      }),
    ]);

  // Appointments
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [bookedThisWeek, upcomingAppointments, recentAppointments] =
    await Promise.all([
      prisma.appointment.count({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          createdAt: { gte: weekStart },
        },
      }),
      prisma.appointment.findMany({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          scheduledAt: { gte: now, lte: sevenDaysFromNow },
          status: { not: "cancelled" },
        },
        include: {
          lead:      { select: { firstName: true, lastName: true } },
          reminders: { select: { messageType: true, sentAt: true, status: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take:    20,
      }),
      prisma.appointment.findMany({
        where: {
          tenantId,
          ...(blueprintIdFilter ? { blueprintId: blueprintIdFilter } : {}),
          scheduledAt: { gte: sevenDaysAgo, lt: now },
        },
        include: {
          lead:      { select: { firstName: true, lastName: true } },
          reminders: { select: { messageType: true, sentAt: true, status: true } },
        },
        orderBy: { scheduledAt: "desc" },
        take:    20,
      }),
    ]);

  // Hero Metrics
  const liveBlueprints = blueprints.filter((b) => b.status === "LIVE");
  const spendTodayUsd  = liveBlueprints.reduce((s, b) => s + b.dailyBudgetUsd, 0);
  const spendTodayGbp  = usdToGbp(spendTodayUsd);
  const leadsThisWeekCount = leadsThisWeek.length;
  const cplThisWeek = leadsThisWeekCount > 0
    ? Math.round((spendTodayGbp * 7) / leadsThisWeekCount * 100) / 100
    : 0;

  const heroMetrics: HeroMetrics = {
    spendToday:     spendTodayGbp,
    leadsToday:     leadsToday,
    cplThisWeek:    cplThisWeek,
    bookedThisWeek: bookedThisWeek,
  };

  // Campaign Health
  const leadsPerBlueprint = new Map<string, number>();
  for (const lead of leadsThisWeek) {
    if (lead.blueprintId) {
      leadsPerBlueprint.set(
        lead.blueprintId,
        (leadsPerBlueprint.get(lead.blueprintId) ?? 0) + 1
      );
    }
  }

  const campaignHealth: CampaignHealthRow[] = blueprints.map((b) => {
    const bpLeads   = leadsPerBlueprint.get(b.id) ?? 0;
    const bpDailyGbp = usdToGbp(b.dailyBudgetUsd);
    const bpSpend   = b.status === "LIVE" ? bpDailyGbp : 0;
    const bpCpl     = bpLeads > 0
      ? Math.round((bpSpend * 7) / bpLeads * 100) / 100
      : 0;
    const mbRaw = b.mediaBuying as Record<string, unknown> | null;
    const ctr   = typeof mbRaw?.ctr === "number" ? mbRaw.ctr : 0;

    return {
      blueprintId:    b.id,
      displayName:    b.businessName,
      vertical:       b.vertical,
      status:         b.status,
      dailyBudgetGbp: bpDailyGbp,
      spendToday:     bpSpend,
      cplThisWeek:    bpCpl,
      ctr:            ctr,
      leadsThisWeek:  bpLeads,
      metaCampaignId: getMetaCampaignId(b.mediaBuying),
    };
  });

  // Recent Calls
  const recentCalls: RecentCallRow[] = allLeadsWithCalls.map((lead) => {
    const ca = lead.callAnalysis as Partial<CallAnalysis> | null;
    return {
      leadId:          lead.id,
      leadName:        `${lead.firstName} ${lead.lastName}`.trim(),
      clientName:      lead.blueprintId
        ? (blueprintNameMap.get(lead.blueprintId) ?? "Unknown Client")
        : "Unknown Client",
      outcome:         getCallOutcome(lead.callAnalysis),
      durationSeconds: Math.round((ca?.durationMs ?? 0) / 1000),
      completedAt:     lead.updatedAt.toISOString(),
    };
  });

  // Booking rows helper
  type AppointmentWithIncludes = typeof upcomingAppointments[number];
  function buildBookingRow(appt: AppointmentWithIncludes): BookingRow {
    const sent = (type: string) =>
      appt.reminders.some((r) => r.messageType === type && r.sentAt !== null);
    return {
      appointmentId: appt.id,
      leadName:      `${appt.lead.firstName} ${appt.lead.lastName}`.trim(),
      clientName:    appt.blueprintId
        ? (blueprintNameMap.get(appt.blueprintId) ?? "Unknown Client")
        : "Unknown Client",
      slotTime:      appt.scheduledAt.toISOString(),
      status:        appt.status,
      remindersSent: {
        confirmation: sent("confirmation"),
        dayBefore:    sent("day_before"),
        hourBefore:   sent("hour_before"),
      },
    };
  }

  const upcomingBookings: BookingRow[] = [
    ...upcomingAppointments.map(buildBookingRow),
    ...recentAppointments.map(buildBookingRow),
  ];

  // Spend Chart
  const spendChart: SpendChartPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = daysAgoUtc(i);
    const dayEnd   = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayLeads = allRecentLeads.filter(
      (l) => l.createdAt >= dayStart && l.createdAt < dayEnd
    );
    spendChart.push({
      date:       isoDate(dayStart),
      spendGbp:   i === 0 ? spendTodayGbp : usdToGbp(spendTodayUsd),
      leadsCount: dayLeads.length,
    });
  }

  const response: DashboardMetricsResponse = {
    heroMetrics,
    campaignHealth,
    recentCalls,
    upcomingBookings,
    spendChart,
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
