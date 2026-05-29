/**
 * GET /api/cron/monthly-report
 * Vercel Cron — runs at 08:00 UTC on the 1st of every month.
 * Generates and emails monthly performance reports for ALL active/trialing agency owners.
 *
 * Protected by CRON_SECRET Bearer token.
 * Always returns 200 — cron endpoint never fails.
 *
 * Query params (optional override):
 *   ?month=5&year=2026
 *   Default: previous calendar month.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateReportsForAllTenants } from "@/lib/cron/monthlyReportGenerator";

export const dynamic = "force-dynamic";

// ── Previous month helper ─────────────────────────────────────────────────────
function previousMonth(): { month: number; year: number } {
  const now   = new Date();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
  const year  = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { month, year };
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Parse month/year ──────────────────────────────────────────────────────
  const url    = req.nextUrl;
  const prev   = previousMonth();

  const rawMonth = url.searchParams.get("month");
  const rawYear  = url.searchParams.get("year");

  const month = rawMonth ? parseInt(rawMonth, 10) : prev.month;
  const year  = rawYear  ? parseInt(rawYear,  10) : prev.year;

  if (month < 1 || month > 12 || year < 2020) {
    return NextResponse.json({ error: "Invalid month or year" }, { status: 400 });
  }

  const startedAt = Date.now();
  console.info(`[cron/monthly-report] Starting report generation for ${month}/${year}`);

  try {
    const result = await generateReportsForAllTenants(month, year);
    const durationMs = Date.now() - startedAt;

    console.info(
      `[cron/monthly-report] Completed: processed=${result.processed} ` +
      `succeeded=${result.succeeded} failed=${result.failed} durationMs=${durationMs}`
    );

    return NextResponse.json({ ...result, durationMs });
  } catch (err) {
    const message    = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startedAt;
    console.error(`[cron/monthly-report] Fatal error: ${message}`);
    // Always return 200 — cron endpoint must never fail
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed:    1,
      durationMs,
      error:     message,
    });
  }
}
