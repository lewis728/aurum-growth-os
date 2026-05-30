// src/lib/cron/monthlyReportGenerator.ts
// Monthly performance report generator.
// Gathers Meta insights + Prisma metrics, calls GPT-4o to write the HTML report,
// upserts MonthlyReport, and emails it to the agency owner.
//
// Golden rules:
//  - NO tier checks. Every active/trialing agency owner receives a report.
//  - Report HTML must never contain vendor technology names.
//  - generateReportsForAllTenants uses Promise.allSettled() — one failure never blocks others.
//  - @@unique([tenantId, month, year]) prevents duplicate generation.

import OpenAI from "openai";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getCampaignInsights } from "@/lib/services/metaAdsService";
import { sendMonthlyReport } from "@/lib/services/emailService";
import type { MonthlyReport } from "@prisma/client";
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
}

interface ReportData {
  tenantId:   string;
  month:      number;
  year:       number;
  blueprints: BlueprintInsights[];
  totals: {
    totalLeads:         number;
    totalBooked:        number;
    totalSpendGbp:      number;
    avgCplGbp:          number | null;
    conversionRate:     number;
    reminderDeliveryRate: number;
  };
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

// ── Per-blueprint data gathering ──────────────────────────────────────────────

async function gatherBlueprintData(
  blueprintId: string,
  businessName: string,
  vertical: string,
  dailyBudgetUsd: number,
  tenantId: string,
  mediaBuying: unknown,
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
      // Meta returns data array; handle both array and object shapes
      const data = Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: Record<string, unknown>[] }).data[0] ?? {})
        : (raw as Record<string, unknown>);

      metaSpendGbp    = data.spend    ? parseFloat(String(data.spend))    : null;
      metaImpressions = data.impressions ? parseInt(String(data.impressions), 10) : null;
      metaClicks      = data.clicks   ? parseInt(String(data.clicks), 10)   : null;
      metaCtr         = data.ctr      ? parseFloat(String(data.ctr))      : null;

      // Extract lead count from actions array
      const actions = data.actions as Array<{ action_type: string; value: string }> | undefined;
      if (actions) {
        const leadAction = actions.find((a) => a.action_type === "lead");
        if (leadAction) {
          metaLeads = parseInt(leadAction.value, 10);
        }
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
    where: {
      blueprintId,
      tenantId,
      createdAt: { gte: start, lte: end },
    },
    select: { status: true },
  });

  const leadsByStatus: Record<string, number> = {};
  for (const l of leads) {
    leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;
  }
  const totalLeads  = leads.length;
  const totalBooked = leadsByStatus["booked"] ?? 0;
  const conversionRate = totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0;

  // ── Appointment stats ─────────────────────────────────────────────────────
  const appointments = await prisma.appointment.findMany({
    where: {
      blueprintId,
      tenantId,
      scheduledAt: { gte: start, lte: end },
    },
    select: { status: true },
  });

  const totalAppointments = appointments.length;
  const attendedCount     = appointments.filter((a) => a.status === "attended").length;
  const noShowRate        = totalAppointments > 0
    ? ((totalAppointments - attendedCount) / totalAppointments) * 100
    : 0;

  // ── Reminder delivery rate ────────────────────────────────────────────────
  const reminders = await prisma.scheduledReminder.findMany({
    where: {
      tenantId,
      createdAt: { gte: start, lte: end },
      appointment: { blueprintId },
    },
    select: { status: true },
  });

  const remindersTotal = reminders.length;
  const remindersSent  = reminders.filter((r) => r.status === "sent").length;
  const reminderDeliveryRate = remindersTotal > 0
    ? (remindersSent / remindersTotal) * 100
    : 0;

  // ── CPL benchmark ─────────────────────────────────────────────────────────
  let cplBenchmarkGbp: number | null = null;
  try {
    const vp = await prisma.verticalProfile.findUnique({ where: { vertical } });
    cplBenchmarkGbp = vp?.cplBenchmarkGbp ?? null;
  } catch {
    // Non-fatal
  }

  return {
    blueprintId,
    businessName,
    vertical,
    dailyBudgetUsd,
    metaSpendGbp,
    metaImpressions,
    metaClicks,
    metaLeads,
    metaCplGbp,
    metaCtr,
    topCreativeName,
    leadsByStatus,
    totalLeads,
    totalBooked,
    conversionRate,
    totalAppointments,
    attendedCount,
    noShowRate,
    remindersSent,
    remindersTotal,
    reminderDeliveryRate,
    cplBenchmarkGbp,
  };
}

// ── GPT-4o report generation ──────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthName(month: number): string {
  return MONTH_NAMES[(month - 1) % 12] ?? String(month);
}

async function generateReportHtml(data: ReportData): Promise<string> {
  const systemPrompt = `You are an elite AI marketing system writing a monthly performance
summary for the agency owner who manages this client account. Write in first person as their
intelligent marketing platform. Be direct, data-driven, and strategic. Do not mention any
vendor technology names (no Meta, Facebook, Retell, Twilio, Higgsfield, OpenAI, or any other
service name). Do not mention the platform name "Aurum" either — write as if this is the
agency's own platform.`;

  const userPrompt = `Here is the performance data for ${monthName(data.month)} ${data.year}:

${JSON.stringify(data, null, 2)}

Write a comprehensive monthly performance report in email-safe HTML with inline styles.
Use a clean, professional layout with white background (#FFFFFF), dark text (#111827),
and gold accent colour (#C9A84C). Sections:
1) Executive Summary (2–3 sentences: what happened this month)
2) Key Metrics Table (spend, leads, CPL, CPL vs benchmark, conversion rate, reminder delivery rate)
3) What Worked This Month (specific creative or targeting insight)
4) What To Improve (one specific, actionable recommendation)
5) Next Month Strategy (concrete recommendation for next month)

Use <table>, <tr>, <td> for the metrics table. Inline all styles.
The agency owner will forward parts of this to their clients — write as if the agency's
platform produced it, not any third-party tool.
Return ONLY the HTML — no markdown, no code fences.`;

  const response = await openai.chat.completions.create({
    model:       "gpt-4o",
    max_tokens:  2000,
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ],
  });

  return response.choices[0]?.message.content ?? "<p>Report generation failed.</p>";
}

// ── generateReportForTenant ───────────────────────────────────────────────────

export async function generateReportForTenant(
  tenantId: string,
  month: number,
  year: number
): Promise<MonthlyReport> {
  // Fetch all LIVE blueprints for the tenant
  const blueprints = await prisma.campaignBlueprint.findMany({
    where:  { tenantId, status: "live" },
    select: {
      id:             true,
      businessName:   true,
      vertical:       true,
      dailyBudgetUsd: true,
      mediaBuying:    true,
    },
  });

  // Gather per-blueprint data (catch individual failures)
  const blueprintResults = await Promise.allSettled(
    blueprints.map((bp) =>
      gatherBlueprintData(
        bp.id,
        bp.businessName,
        bp.vertical,
        bp.dailyBudgetUsd,
        tenantId,
        bp.mediaBuying,
        month,
        year
      )
    )
  );

  const bpData: BlueprintInsights[] = [];
  for (let i = 0; i < blueprintResults.length; i++) {
    const result = blueprintResults[i];
    if (result?.status === "fulfilled") {
      bpData.push(result.value);
    } else {
      console.warn(
        `[monthlyReportGenerator] Blueprint ${blueprints[i]?.id} data gathering failed:`,
        (result as PromiseRejectedResult).reason
      );
    }
  }

  // Compute totals
  const totalLeads     = bpData.reduce((s, b) => s + b.totalLeads, 0);
  const totalBooked    = bpData.reduce((s, b) => s + b.totalBooked, 0);
  const totalSpendGbp  = bpData.reduce((s, b) => s + (b.metaSpendGbp ?? 0), 0);
  const cplValues      = bpData.map((b) => b.metaCplGbp).filter((v): v is number => v !== null);
  const avgCplGbp      = cplValues.length > 0
    ? cplValues.reduce((s, v) => s + v, 0) / cplValues.length
    : null;
  const conversionRate = totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0;
  const drValues       = bpData.filter((b) => b.remindersTotal > 0).map((b) => b.reminderDeliveryRate);
  const reminderDeliveryRate = drValues.length > 0
    ? drValues.reduce((s, v) => s + v, 0) / drValues.length
    : 0;

  const reportData: ReportData = {
    tenantId,
    month,
    year,
    blueprints: bpData,
    totals: {
      totalLeads,
      totalBooked,
      totalSpendGbp,
      avgCplGbp,
      conversionRate,
      reminderDeliveryRate,
    },
  };

  // Generate HTML via GPT-4o
  const reportHtml = await generateReportHtml(reportData);

  // Upsert MonthlyReport (@@unique prevents duplicates)
  const report = await prisma.monthlyReport.upsert({
    where:  { tenantId_month_year: { tenantId, month, year } },
    create: {
      tenantId,
      month,
      year,
      reportHtml,
      reportData: reportData as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
    update: {
      reportHtml,
      reportData: reportData as unknown as import("@prisma/client").Prisma.InputJsonValue,
      generatedAt: new Date(),
    },
  });

  return report;
}

// ── generateReportsForAllTenants ──────────────────────────────────────────────

export async function generateReportsForAllTenants(
  month: number,
  year: number
): Promise<{ processed: number; succeeded: number; failed: number }> {
  // Fetch all active/trialing tenants — NO tier checks
  const subscriptions = await prisma.agencySubscription.findMany({
    where:  { status: { in: ["active", "trialing"] } },
    select: { tenantId: true },
  });

  const tenantIds = Array.from(new Set(subscriptions.map((s) => s.tenantId)));
  const processed = tenantIds.length;

  const results = await Promise.allSettled(
    tenantIds.map(async (tenantId) => {
      // Fetch Clerk org to get owner email
      const org = await clerkClient.organizations.getOrganization({
        organizationId: tenantId,
      });

      // Get the first admin member's email
      const memberships = await clerkClient.organizations.getOrganizationMembershipList({
        organizationId: tenantId,
      });

      let ownerEmail = "";
      for (const membership of memberships.data) {
        if (membership.role === "org:admin") {
          // publicUserData.identifier is the member's primary email in Clerk v5.
          ownerEmail = membership.publicUserData?.identifier ?? "";
          if (ownerEmail) break;
        }
      }

      if (!ownerEmail) {
        throw new Error(`No admin email found for org ${tenantId} (${org.name})`);
      }

      const report = await generateReportForTenant(tenantId, month, year);
      await sendMonthlyReport(tenantId, report.reportHtml, ownerEmail, month, year);
    })
  );

  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === "fulfilled") {
      succeeded++;
    } else {
      failed++;
      const tenantId = tenantIds[i] ?? "unknown";
      const reason   = (result as PromiseRejectedResult).reason;
      const message  = reason instanceof Error ? reason.message : String(reason);
      console.error(`[monthlyReportGenerator] Report failed for tenantId=${tenantId}: ${message}`);
      try {
        await prisma.commandLog.create({
          data: {
            tenantId,
            rawInput:   `cron:monthly-report:${month}/${year}`,
            intentType: "REPORT_FAILED",
            success:    false,
            errorMsg:   message,
          },
        });
      } catch {
        // Non-fatal
      }
    }
  }

  return { processed, succeeded, failed };
}
