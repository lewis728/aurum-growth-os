/**
 * src/lib/agents/verticalTrainer.ts
 * SERVER-SIDE ONLY.
 *
 * ── THE VERTICAL TRAINER (Sprint 13) ────────────────────────────────────────
 * Weekly, per vertical, this distils a living "30-year expert" brief that EVERY
 * client agent in that vertical reads before every decision (the Media Buyer
 * folds `VerticalProfile.expertBrief` into its reasoning context). It is
 * cross-tenant and anonymous — it describes the *market*, never a client.
 *
 * Pipeline per vertical (one VerticalProfile row):
 *   1. Scrape the Meta Ad Library for live GB ads in this vertical
 *      (graceful: skipped cleanly when no ad-library token is configured — the
 *       Meta app is pending approval, so the brief is still written from expert
 *       knowledge + our own benchmark).
 *   2. GPT-4o analyses: what's winning / saturated / emerging + audience/timing +
 *      the current ASA/CAP compliance rules for the vertical.
 *   3. Distil into a ≤2000-word first-person expert brief.
 *   4. Persist to VerticalProfile.expertBrief (+ lastTrainedAt + perf metadata).
 *
 * FAIL-SAFE: trainVertical never throws; the cron logs and continues.
 */

import OpenAI from "openai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchAdLibrary, summariseAds } from "@/lib/services/metaAdLibrary";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_BRIEF_WORDS = 2000;
const AD_SAMPLE_LIMIT = 40;

export interface VerticalTrainingResult {
  vertical:       string;
  ok:             boolean;
  briefChars:     number;
  adLibraryCount: number;
  usedAdLibrary:  boolean;
  note?:          string;
}

function capWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return words.slice(0, max).join(" ") + " …";
}

async function writeExpertBrief(
  label: string,
  adSummary: string,
  benchmarkLine: string,
): Promise<string> {
  const system =
    `You are a media buyer and advertising-compliance specialist with 30 years' ` +
    `experience in the UK ${label} market. You write the single internal brief that ` +
    `every junior buyer reads before touching a campaign. You are precise, current, ` +
    `and never generic. You write in the first person.`;

  const user = [
    `Write the weekly expert brief for the UK ${label} vertical.`,
    ``,
    benchmarkLine,
    ``,
    adSummary
      ? `Live competitor ads currently running in GB (Meta Ad Library sample):\n${adSummary}`
      : `No live ad sample is available this week — write from your own expert knowledge of the UK ${label} market.`,
    ``,
    `Cover, in tight prose with short bold section headers:`,
    `1. WHAT'S WINNING — the ad formats, hooks and offers converting right now and why.`,
    `2. WHAT'S SATURATED — angles that are fatigued or over-used; what to avoid.`,
    `3. WHAT'S EMERGING — early signals worth testing in the next 30–60 days.`,
    `4. AUDIENCE & TIMING — who converts, and the best days/times to reach them.`,
    `5. COMPLIANCE — the current ASA/CAP rules that matter for this vertical: claims ` +
      `that get ads rejected or complaints upheld, required disclaimers, and language to never use.`,
    ``,
    `Be specific to ${label}. No filler, no hedging. Maximum ${MAX_BRIEF_WORDS} words.`,
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model:       "gpt-4o",
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  return capWords(raw, MAX_BRIEF_WORDS);
}

/**
 * Trains one vertical (by its VerticalProfile.vertical key). NEVER THROWS.
 */
export async function trainVertical(vertical: string): Promise<VerticalTrainingResult> {
  try {
    const profile = await prisma.verticalProfile.findUnique({
      where:  { vertical },
      select: { vertical: true, displayName: true, cplBenchmarkGbp: true, performanceData: true },
    });
    if (!profile) {
      return { vertical, ok: false, briefChars: 0, adLibraryCount: 0, usedAdLibrary: false, note: "no VerticalProfile row" };
    }

    const label = profile.displayName || vertical;
    const benchmarkLine = profile.cplBenchmarkGbp
      ? `Our network benchmark CPL for this vertical is £${profile.cplBenchmarkGbp.toFixed(2)}. Calibrate your guidance against this.`
      : `We have no firm CPL benchmark for this vertical yet — give realistic UK ranges from your own experience.`;

    const rows = await searchAdLibrary(label, { country: "GB", limit: AD_SAMPLE_LIMIT });
    const adSummary = rows.length ? summariseAds(rows) : "";

    const brief = await writeExpertBrief(label, adSummary, benchmarkLine);
    if (!brief) {
      return { vertical, ok: false, briefChars: 0, adLibraryCount: rows.length, usedAdLibrary: rows.length > 0, note: "empty brief" };
    }

    const priorPerf =
      profile.performanceData && typeof profile.performanceData === "object" && !Array.isArray(profile.performanceData)
        ? (profile.performanceData as Record<string, unknown>)
        : {};

    await prisma.verticalProfile.update({
      where: { vertical },
      data: {
        expertBrief:   brief,
        lastTrainedAt: new Date(),
        performanceData: {
          ...priorPerf,
          adLibrarySampleSize: rows.length,
          trainingSource:      rows.length ? "ad_library+gpt" : "gpt_expert_knowledge",
        } as Prisma.InputJsonValue,
      },
    });

    return { vertical, ok: true, briefChars: brief.length, adLibraryCount: rows.length, usedAdLibrary: rows.length > 0 };
  } catch (err) {
    console.error(`[verticalTrainer] trainVertical(${vertical}) failed:`, err instanceof Error ? err.message : err);
    return { vertical, ok: false, briefChars: 0, adLibraryCount: 0, usedAdLibrary: false, note: err instanceof Error ? err.message : "error" };
  }
}

/** Trains every vertical that has a VerticalProfile row, sequentially. Never throws. */
export async function trainAllVerticals(): Promise<VerticalTrainingResult[]> {
  const profiles = await prisma.verticalProfile.findMany({ select: { vertical: true } }).catch(() => []);
  const results: VerticalTrainingResult[] = [];
  for (const p of profiles) {
    results.push(await trainVertical(p.vertical));
  }
  return results;
}
