// src/lib/cron/monthlyReportGenerator.ts
// Monthly performance + ROI report generator.
// Gathers Meta insights + Prisma metrics, computes revenue/ROI/trend, calls
// GPT-4o to write the HTML, upserts the tenant-level MonthlyReport (emailed to
// the agency owner), and emails a white-labelled per-client report to each
// client's contact email.
//
// Golden rules:
//  - NO tier checks. Every active/trialing agency owner gets a report.
//  - Report HTML must never contain vendor technology names, nor "Aurum" in the
//    client-facing report.
//  - Promise.allSettled() everywhere — one failure never blocks the others.
//  - @@unique([tenantId, month, year]) prevents duplicate tenant reports.
//  - Revenue works even when Meta is unavailable (it's booked × client value);
//    ROI degrades gracefully to null when spend is unknown.

import OpenAI from "openai";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getCampaignInsights } from "@/lib/services/metaAdsService";
import { sendMonthlyReport, sendClientReport } from "@/lib/services/emailService";
import { getBranding } from "@/lib/services/brandingService";
import type { MonthlyReport, Prisma } from "@prisma/client";
import type { MediaBuyingLayer } from "@/types/mediaBuyingLayer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

interface BlueprintInsights {
  blueprintId:        string;
  businessName:       string;
  vertical:           string;
  dailyBudgetUsd:     number;
  metaSpendGbp:       number | null;
  metaImpressions:    number | null;
  metaClicks:         number | null;
  metaLeads:          number | null;
  metaCplGbp:         number | null;
  metaCtr:            number | null;
  topCreativeName:    string | null;
  leadsByStatus:      Record<string, number>;
  totalLeads:         number;
  totalBooked:        number;
  conversionRate:     number;
  totalAppointments:  number;
  attendedCount:      number;
  noShowRate:         number;
  remindersSent:      number;
  remindersTotal:     number;
  reminderDeliveryRate: number;
  cplBenchmarkGbp:    number | null;
  // ── ROI (Sprint 5) ──────────────────────────────────────────────────────────
  averageClientValueGbp: number | null; // ClientBrief.averageClientValue
  revenueGbp:            number | null; // totalBooked × averageClientValue
  roi:                   number | null; // revenueGbp / metaSpendGbp (×, e.g. 4.2)
}

interface ReportTotals {
  totalLeads:           number;
  totalBooked:          number;
  totalSpendGbp:        number;
  avgCplGbp:            number | null;
  conversionRate:       number;
  reminderDeliveryRate: number;
  totalRevenueGbp:      number | null; // null only if NO client has a value set
  overallRoi:           number | null; // totalRevenueGbp / totalSpendGbp
}

interface ReportTrend {
  hasPrevious:        boolean;
  leadsDeltaPct:      number | null;
  bookedDeltaPct:     number | null;
  revenueDeltaPct:    number | null;
  cplDeltaPct:        number | null; // negative = CPL improved (cheaper)
}

interface ReportData {
  tenantId:   string;
  month:      number;
  year:       number;
  blueprints: BlueprintInsights[];
  totals:     ReportTotals;
  trend:      ReportTrend;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function monthDateRange(month: number, year: number): { since: string; until: string } {
  const since = new Date(year, month - 1, 1);
  const until = new Date(year, month, 0); // last day of month
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}

function monthStartEnd(month: number, year: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month - 1, 1),
    end:   new Date(year, month, 0, 23, 59, 59, 999),
  };
}

function previousMonthOf(month: number, year: number): { month: number; year: number } {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null; // can't divide by zero
  return ((current - previous) / previous) * 100;
}

// ── Per-blueprint data gathering ──────────────────────────────────────────────

async function gatherBlueprintData(
  blueprintId: string,
  businessName: string,
  vertical: string,
  dailyBudgetUsd: number,
  tenantId: string,
  mediaBuying: unknown,
  averageClientValueGbp: number | null,
  month: number,
  year: number
): Promise<BlueprintInsights> {
  const dateRange = monthDateRange(month, year);
  const { start, end } = monthStartEnd(month, year);

  // ── Meta insights ─────────────────────────────────────────────────────────
  let metaSpendGbp:    number | null = null;
  let metaImpressions: number | null = null;
  let metaClicks:      number | null = null;
  let metaLeads:       number | null = null;
  let metaCplGbp:      number | null = null;
  let metaCtr:         number | null = null;
  const topCreativeName: string | null = null;

  try {
    const mb = mediaBuying as MediaBuyingLayer | null;
    const campaignId = mb?.metaAdIds?.campaignId;
    if (campaignId) {
      const raw = await getCampaignInsights(campaignId, dateRange, tenantId);
      const data = Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: Record<string, unknown>[] }).data[0] ?? {})
        : (raw as Record<string, unknown>);

      metaSpendGbp    = data.spend       ? parseFloat(String(data.spend))         : null;
      metaImpressions = data.impressions ? parseInt(String(data.impressions), 10) : null;
      metaClicks      = data.clicks      ? parseInt(String(data.clicks), 10)      : null;
      metaCtr         = data.ctr         ? parseFloat(String(data.ctr))           : null;

      const actions = data.actions as Array<{ action_type: string; value: string }> | undefined;
      if (actions) {
        const leadAction = actions.find((a) => a.action_type === "lead");
        if (leadAction) metaLeads = parseInt(leadAction.value, 10);
      }

      if (metaSpendGbp !== null && metaLeads !== null && metaLeads > 0) {
        metaCplGbp = metaSpendGbp / metaLeads;
      }
    }
  } catch (err) {
    console.warn(`[monthlyReportGenerator] Meta insights failed for blueprint ${blueprintId}:`, err);
  }

  // ── Lead stats ────────────────────────────────────────────────────────────
  const leads = await prisma.lead.findMany({
    where: { blueprintId, tenantId, createdAt: { gte: start, lte: end } },
    select: { status: true },
  });

  const leadsByStatus: Record<string, number> = {};
  for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;
  const totalLeads     = leads.length;
  const totalBooked    = leadsByStatus["booked"] ?? 0;
  const conversionRate = totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0;

  // ── Appointment stats ─────────────────────────────────────────────────────
  const appointments = await prisma.appointment.findMany({
    where: { blueprintId, tenantId, scheduledAt: { gte: start, lte: end } },
    select: { status: true },
  });
  const totalAppointments = appointments.length;
  const attendedCount     = appointments.filter((a) => a.status === "attended").length;
  const noShowRate        = totalAppointments > 0
    ? ((totalAppointments - attendedCount) / totalAppointments) * 100
    : 0;

  // ── Reminder delivery rate ────────────────────────────────────────────────
  const reminders = await prisma.scheduledReminder.findMany({
    where: { tenantId, createdAt: { gte: start, lte: end }, appointment: { blueprintId } },
    select: { status: true },
  });
  const remindersTotal = reminders.length;
  const remindersSent  = reminders.filter((r) => r.status === "sent").length;
  const reminderDeliveryRate = remindersTotal > 0 ? (remindersSent / remindersTotal) * 100 : 0;

  // ── CPL benchmark ─────────────────────────────────────────────────────────
  let cplBenchmarkGbp: number | null = null;
  try {
    const vp = await prisma.verticalProfile.findUnique({ where: { vertical } });
    cplBenchmarkGbp = vp?.cplBenchmarkGbp ?? null;
  } catch { /* non-fatal */ }

  // ── Revenue + ROI (Sprint 5) ──────────────────────────────────────────────
  // Revenue = leads × booking rate × avg client value = booked × avg client value.
  // Computable without Meta. ROI needs spend, so it degrades to null without Meta.
  const revenueGbp = averageClientValueGbp !== null ? totalBooked * averageClientValueGbp : null;
  const roi = revenueGbp !== null && metaSpendGbp !== null && metaSpendGbp > 0
    ? revenueGbp / metaSpendGbp
    : null;

  return {
    blueprintId, businessName, vertical, dailyBudgetUsd,
    metaSpendGbp, metaImpressions, metaClicks, metaLeads, metaCplGbp, metaCtr, topCreativeName,
    leadsByStatus, totalLeads, totalBooked, conversionRate,
    totalAppointments, attendedCount, noShowRate,
    remindersSent, remindersTotal, reminderDeliveryRate, cplBenchmarkGbp,
    averageClientValueGbp, revenueGbp, roi,
  };
}

// ── Trend vs previous month ─────────────────────────────────────────────────

async function computeTrend(tenantId: string, month: number, year: number, totals: ReportTotals): Promise<ReportTrend> {
  const empty: ReportTrend = {
    hasPrevious: false, leadsDeltaPct: null, bookedDeltaPct: null, revenueDeltaPct: null, cplDeltaPct: null,
  };
  try {
    const prev = previousMonthOf(month, year);
    const prevReport = await prisma.monthlyReport.findUnique({
      where: { tenantId_month_year: { tenantId, month: prev.month, year: prev.year } },
      select: { reportData: true },
    });
    if (!prevReport?.reportData) return empty;

    const prevTotals = (prevReport.reportData as { totals?: Partial<ReportTotals> }).totals;
    if (!prevTotals) return empty;

    return {
      hasPrevious:     true,
      leadsDeltaPct:   pctDelta(totals.totalLeads, prevTotals.totalLeads ?? 0),
      bookedDeltaPct:  pctDelta(totals.totalBooked, prevTotals.totalBooked ?? 0),
      revenueDeltaPct: totals.totalRevenueGbp !== null && prevTotals.totalRevenueGbp != null
        ? pctDelta(totals.totalRevenueGbp, prevTotals.totalRevenueGbp)
        : null,
      cplDeltaPct:     totals.avgCplGbp !== null && prevTotals.avgCplGbp != null
        ? pctDelta(totals.avgCplGbp, prevTotals.avgCplGbp)
        : null,
    };
  } catch (err) {
    console.warn(`[monthlyReportGenerator] trend computation failed for ${tenantId}:`, err);
    return empty;
  }
}

// ── GPT-4o report generation ──────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function monthName(month: number): string {
  return MONTH_NAMES[(month - 1) % 12] ?? String(month);
}

const FALLBACK_HTML = "<p>Report generation is temporarily unavailable. Your performance data is recorded and your next report will resume normally.</p>";

/** Tenant-level (agency-owner-facing) report — portfolio across all clients. */
async function generateReportHtml(data: ReportData): Promise<string> {
  const systemPrompt = `You are an elite AI marketing system writing a monthly performance
summary for the agency owner who manages these client accounts. Write in first person as their
intelligent marketing platform. Be direct, data-driven, and strategic. Lead with the money:
revenue generated and ROI are the most important numbers. Do not mention any vendor technology
names (no Meta, Facebook, Retell, Twilio, Higgsfield, OpenAI, or any service name), and do not
mention the platform name "Aurum" — write as if this is the agency's own platform.`;

  const userPrompt = `Performance data for ${monthName(data.month)} ${data.year}:

${JSON.stringify(data, null, 2)}

Write a monthly performance report in email-safe HTML with inline styles. Clean professional
layout: white background (#FFFFFF), dark text (#111827), gold accent (#C9A84C). Sections:
1) Executive Summary — lead with revenue generated and ROI, then leads/bookings.
2) The Money — state plainly: "At your clients' average values, the campaigns generated
   approximately £X in new revenue against £Y in ad spend — an ROI of Zx." Use the real numbers
   from totals (totalRevenueGbp, totalSpendGbp, overallRoi). If revenue is null, say revenue
   couldn't be estimated because no average client value is set, and prompt them to add it.
3) Month-on-month trend — use the "trend" object. If hasPrevious is false, say this is the first
   full month of data so trends start next month. Otherwise describe leads/bookings/revenue/CPL
   movement (note: a NEGATIVE cplDeltaPct means CPL got cheaper — that's good).
4) Key Metrics Table — <table>/<tr>/<td>, inline styles: spend, leads, CPL, CPL vs benchmark,
   conversion rate, revenue, ROI, reminder delivery rate.
5) What To Improve — one specific, actionable recommendation.
6) Next Month Strategy — one concrete recommendation.

Return ONLY the HTML — no markdown, no code fences.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", max_tokens: 2200, temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    });
    return response.choices[0]?.message.content?.trim() || FALLBACK_HTML;
  } catch (err) {
    console.error("[monthlyReportGenerator] owner report GPT failed:", err instanceof Error ? err.message : err);
    return FALLBACK_HTML;
  }
}

/** Client-facing report — ONE campaign, written for the agency's client. White-label. */
async function generateClientReportHtml(
  bp: BlueprintInsights,
  agencyName: string,
  month: number,
  year: number,
  trend: ReportTrend
): Promise<string> {
  const systemPrompt = `You are writing a monthly results email FROM a marketing agency named
"${agencyName}" TO their client, the business owner at "${bp.businessName}". Warm, confident,
plain-English — you are proving the agency earned its fee. Lead with revenue and bookings, not
vanity metrics. NEVER mention any technology vendor (no Meta, Facebook, Retell, Twilio, OpenAI),
never mention "Aurum", and never imply the work was automated — write as the agency's own team.`;

  const payload = {
    business: bp.businessName,
    leads: bp.totalLeads, booked: bp.totalBooked, conversionRatePct: bp.conversionRate,
    averageClientValueGbp: bp.averageClientValueGbp, revenueGbp: bp.revenueGbp,
    adSpendGbp: bp.metaSpendGbp, roi: bp.roi,
    revenueTrendPct: trend.revenueDeltaPct, bookedTrendPct: trend.bookedDeltaPct,
  };

  const headline = bp.revenueGbp !== null
    ? `we generated approximately £${Math.round(bp.revenueGbp)} in new revenue for you this month`
    : `we booked ${bp.totalBooked} new appointments for you this month`;

  const userPrompt = `Client results for ${monthName(month)} ${year}:

${JSON.stringify(payload, null, 2)}

Write a short, polished results email in email-safe HTML with inline styles (white background,
dark text #111827, gold accent #C9A84C). Structure:
- A warm one-line opener addressed to the ${bp.businessName} team.
- The headline result: "${headline}".
  ${bp.roi !== null ? `Mention the ROI (${bp.roi.toFixed(1)}x return on ad spend) plainly.` : ""}
- A small metrics table: leads, booked appointments, ${bp.revenueGbp !== null ? "estimated revenue, " : ""}conversion rate.
- One sentence on momentum vs last month if a trend is present.
- A confident closing line and sign-off from the ${agencyName} team.
Return ONLY the HTML — no markdown, no code fences.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", max_tokens: 1400, temperature: 0.5,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    });
    return response.choices[0]?.message.content?.trim() || FALLBACK_HTML;
  } catch (err) {
    console.error(`[monthlyReportGenerator] client report GPT failed for ${bp.blueprintId}:`, err instanceof Error ? err.message : err);
    return FALLBACK_HTML;
  }
}

// ── generateReportForTenant ───────────────────────────────────────────────────

export async function generateReportForTenant(
  tenantId: string,
  month: number,
  year: number
): Promise<MonthlyReport> {
  // LIVE blueprints + their brief (avg client value + client contact email).
  const blueprints = await prisma.campaignBlueprint.findMany({
    where:  { tenantId, status: "live" },
    select: {
      id: true, businessName: true, vertical: true, dailyBudgetUsd: true, mediaBuying: true,
      clientBrief: { select: { averageClientValue: true, clientContactEmail: true } },
    },
  });

  const blueprintResults = await Promise.allSettled(
    blueprints.map((bp) =>
      gatherBlueprintData(
        bp.id, bp.businessName, bp.vertical, bp.dailyBudgetUsd, tenantId,
        bp.mediaBuying, bp.clientBrief?.averageClientValue ?? null, month, year
      )
    )
  );

  const bpData: BlueprintInsights[] = [];
  for (let i = 0; i < blueprintResults.length; i++) {
    const result = blueprintResults[i];
    if (result?.status === "fulfilled") bpData.push(result.value);
    else console.warn(`[monthlyReportGenerator] Blueprint ${blueprints[i]?.id} data gathering failed:`, (result as PromiseRejectedResult).reason);
  }

  // ── Totals (incl. revenue + ROI) ────────────────────────────────────────────
  const totalLeads    = bpData.reduce((s, b) => s + b.totalLeads, 0);
  const totalBooked   = bpData.reduce((s, b) => s + b.totalBooked, 0);
  const totalSpendGbp = bpData.reduce((s, b) => s + (b.metaSpendGbp ?? 0), 0);
  const cplValues     = bpData.map((b) => b.metaCplGbp).filter((v): v is number => v !== null);
  const avgCplGbp     = cplValues.length > 0 ? cplValues.reduce((s, v) => s + v, 0) / cplValues.length : null;
  const conversionRate = totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0;
  const drValues       = bpData.filter((b) => b.remindersTotal > 0).map((b) => b.reminderDeliveryRate);
  const reminderDeliveryRate = drValues.length > 0 ? drValues.reduce((s, v) => s + v, 0) / drValues.length : 0;

  const revenueValues   = bpData.map((b) => b.revenueGbp).filter((v): v is number => v !== null);
  const totalRevenueGbp = revenueValues.length > 0 ? revenueValues.reduce((s, v) => s + v, 0) : null;
  const overallRoi = totalRevenueGbp !== null && totalSpendGbp > 0 ? totalRevenueGbp / totalSpendGbp : null;

  const totals: ReportTotals = {
    totalLeads, totalBooked, totalSpendGbp, avgCplGbp, conversionRate,
    reminderDeliveryRate, totalRevenueGbp, overallRoi,
  };

  const trend = await computeTrend(tenantId, month, year, totals);

  const reportData: ReportData = { tenantId, month, year, blueprints: bpData, totals, trend };

  // Tenant-level (owner-facing) report.
  const reportHtml = await generateReportHtml(reportData);

  const report = await prisma.monthlyReport.upsert({
    where:  { tenantId_month_year: { tenantId, month, year } },
    create: { tenantId, month, year, reportHtml, reportData: reportData as unknown as Prisma.InputJsonValue },
    update: { reportHtml, reportData: reportData as unknown as Prisma.InputJsonValue, generatedAt: new Date() },
  });

  // ── Per-client white-labelled reports (Sprint 5) ────────────────────────────
  // For every live client WITH a contact email, generate a client-facing report
  // and email it under the agency's brand. Isolated per client — one failure
  // never blocks the others, and never blocks the owner report (already saved).
  const agencyBranding = await getBranding(tenantId).catch(() => null);
  const agencyName = agencyBranding?.agencyName ?? "Your Marketing Team";

  const emailable = blueprints
    .map((bp) => ({ email: bp.clientBrief?.clientContactEmail ?? null, data: bpData.find((d) => d.blueprintId === bp.id) }))
    .filter((x): x is { email: string; data: BlueprintInsights } => Boolean(x.email && x.data));

  await Promise.allSettled(
    emailable.map(async ({ email, data }) => {
      const html = await generateClientReportHtml(data, agencyName, month, year, trend);
      await sendClientReport(tenantId, html, email, data.businessName, month, year);
    })
  );

  return report;
}

// ── generateReportsForAllTenants ──────────────────────────────────────────────

export async function generateReportsForAllTenants(
  month: number,
  year: number
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const subscriptions = await prisma.agencySubscription.findMany({
    where:  { status: { in: ["active", "trialing"] } },
    select: { tenantId: true },
  });

  const tenantIds = Array.from(new Set(subscriptions.map((s) => s.tenantId)));
  const processed = tenantIds.length;

  const results = await Promise.allSettled(
    tenantIds.map(async (tenantId) => {
      const org = await clerkClient.organizations.getOrganization({ organizationId: tenantId });
      const memberships = await clerkClient.organizations.getOrganizationMembershipList({ organizationId: tenantId });

      let ownerEmail = "";
      for (const membership of memberships.data) {
        if (membership.role === "org:admin") {
          ownerEmail = membership.publicUserData?.identifier ?? "";
          if (ownerEmail) break;
        }
      }
      if (!ownerEmail) throw new Error(`No admin email found for org ${tenantId} (${org.name})`);

      const report = await generateReportForTenant(tenantId, month, year);
      await sendMonthlyReport(tenantId, report.reportHtml, ownerEmail, month, year);
    })
  );

  let succeeded = 0, failed = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === "fulfilled") { succeeded++; continue; }
    failed++;
    const tenantId = tenantIds[i] ?? "unknown";
    const reason   = (result as PromiseRejectedResult).reason;
    const message  = reason instanceof Error ? reason.message : String(reason);
    console.error(`[monthlyReportGenerator] Report failed for tenantId=${tenantId}: ${message}`);
    try {
      await prisma.commandLog.create({
        data: { tenantId, rawInput: `cron:monthly-report:${month}/${year}`, intentType: "REPORT_FAILED", success: false, errorMsg: message },
      });
    } catch { /* non-fatal */ }
  }

  return { processed, succeeded, failed };
}
