// src/app/api/cron/performance-aggregation/route.ts
// GET /api/cron/performance-aggregation
// Triggered by Vercel Cron at 3am UTC every Monday (0 3 * * 1).
//
// Authentication: Bearer CRON_SECRET header.
// Always returns 200 — never fails the cron endpoint.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { runWeeklyAggregation } from "@/lib/cron/performanceAggregator";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cron/performance-aggregation] CRON_SECRET env var is not set.");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token      = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Run aggregation ─────────────────────────────────────────────────────────
  const startMs = Date.now();

  try {
    const { processed, succeeded, failed } = await runWeeklyAggregation();
    const durationMs = Date.now() - startMs;

    console.info(
      `[cron/performance-aggregation] Complete: processed=${processed} ` +
      `succeeded=${succeeded} failed=${failed} durationMs=${durationMs}`
    );

    return NextResponse.json({ processed, succeeded, failed, durationMs }, { status: 200 });
  } catch (err) {
    // runWeeklyAggregation should never throw, but guard anyway
    const message    = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;

    console.error(`[cron/performance-aggregation] Unexpected error: ${message}`);

    return NextResponse.json(
      { processed: 0, succeeded: 0, failed: 0, durationMs, error: message },
      { status: 200 } // Always 200 — never fail the cron endpoint
    );
  }
}
