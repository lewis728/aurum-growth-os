/**
 * src/app/api/cron/vertical-training/route.ts
 * Weekly cron (Sunday 00:00) — trains every vertical's expert brief (Sprint 13).
 * Auth: Bearer CRON_SECRET. Fail-safe per vertical (trainVertical never throws).
 *
 * The result feeds VerticalProfile.expertBrief, which the Media Buyer (and any
 * vertical-aware role) reads before every decision — so the whole network gets
 * smarter every week without touching a single client config.
 */

import { NextRequest, NextResponse } from "next/server";
import { trainAllVerticals } from "@/lib/agents/verticalTrainer";

export const dynamic = "force-dynamic";
// Training all verticals makes one GPT call each (+ optional ad-library fetch);
// give it headroom beyond the default serverless window.
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await trainAllVerticals();
  const trained = results.filter((r) => r.ok).length;
  const failed  = results.length - trained;
  const withAds = results.filter((r) => r.usedAdLibrary).length;

  return NextResponse.json(
    { trained, failed, withAds, total: results.length, results },
    { status: 200 },
  );
}
