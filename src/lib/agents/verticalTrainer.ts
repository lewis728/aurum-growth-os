/**
 * src/lib/agents/verticalTrainer.ts
 * SERVER-SIDE ONLY.
 *
 * ── THE VERTICAL TRAINER (Sprint 13) ────────────────────────────────────────
 * Weekly, per vertical, this distils a living "30-year expert" brief that EVERY
 * client agent in that vertical reads before every decision (the Media Buyer
 * already consumes `VerticalProfile.expertBrief`). It is cross-tenant and
 * anonymous — it describes the *market*, never a specific client.
 *
 * Pipeline per vertical:
 *   1. Scrape the Meta Ad Library for live ads in this vertical in GB
 *      (graceful: skipped cleanly when no ad-library token is configured —
 *       the Meta app is pending approval, so the brief is still written from
 *       expert knowledge + our own simulated/real benchmarks).
 *   2. GPT-4o analyses: which formats are winning, which are saturated, which
 *      are emerging — plus the current ASA/CAP compliance rules for the vertical.
 *   3. Distil into a ≤2000-word first-person expert brief.
 *   4. Persist to VerticalProfile.expertBrief (+ training metadata).
 *
 * FAIL-SAFE: trainVertical never throws; the cron logs and continues.
 */

import { openai, OPENAI_MODEL } from "@/lib/services/openaiClient";
import { metaGet } from "@/lib/services/metaInsightsService";
import { getVerticalBenchmark, upsertVerticalBenchmark } from "@/lib/services/verticalBenchmarkService";
import { VERTICAL_LABELS } from "@/lib/constants/verticals";

const MAX_BRIEF_WORDS = 2000;
const AD_SAMPLE_LIMIT = 40;

export interface VerticalTrainingResult {
  vertical:        string;
  ok:              boolean;
  briefChars:      number;
  adLibraryCount:  number;   // 0 when the scrape was skipped or returned nothing
  usedAdLibrary:   boolean;
  note?:           string;
}

// ── Meta Ad Library (graceful shell) ────────────────────────────────────────

interface AdArchiveRow {
  ad_creative_bodies?:        string[];
  ad_creative_link_titles?:   string[];
  ad_creative_link_captions?: string[];
  publisher_platforms?:       string[];
  page_name?:                 string;
}

/**
 * Pulls a sample of live ads for the vertical in GB. Returns [] when no
 * ad-library token is configured or the call fails — never throws.
 *
 * The Ad Library uses any valid Meta token (it's a public endpoint); we keep it
 * on its own env var so it's independent of the per-tenant ads tokens.
 */
async function scrapeAdLibrary(label: string): Promise<AdArchiveRow[]> {
  const token = process.env.META_ADLIBRARY_TOKEN;
  if (!token) return [];
  try {
    const res = await metaGet<{ data?: AdArchiveRow[] }>("ads_archive", {
      access_token:        token,
      search_terms:        label,
      ad_reached_countries: '["GB"]',
      ad_active_status:    "ACTIVE",
      ad_type:             "ALL",
      fields:              "ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,publisher_platforms,page_name",
      limit:               String(AD_SAMPLE_LIMIT),
    });
    return res.data ?? [];
  } catch (err) {
    console.error(`[verticalTrainer] Ad Library scrape failed for "${label}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

/** Compresses raw ad rows into short lines GPT can reason over. */
function summariseAds(rows: AdArchiveRow[]): string {
  return rows
    .map((r, i) => {
      const body = (r.ad_creative_bodies ?? []).join(" ").replace(/\s+/g, " ").trim().slice(0, 220);
      const title = (r.ad_creative_link_titles ?? []).join(" ").trim().slice(0, 100);
      const platforms = (r.publisher_platforms ?? []).join("/");
      if (!body && !title) return null;
      return `${i + 1}. [${platforms || "?"}] ${title ? `"${title}" — ` : ""}${body}`;
    })
    .filter((l): l is string => l !== null)
    .slice(0, AD_SAMPLE_LIMIT)
    .join("\n");
}

function capWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return words.slice(0, max).join(" ") + " …";
}

// ── The brief writer ────────────────────────────────────────────────────────

async function writeExpertBrief(
  vertical: string,
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
    model:       OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  return capWords(raw, MAX_BRIEF_WORDS);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Trains one vertical. NEVER THROWS — returns ok:false with a note on failure so
 * the cron can keep going.
 */
export async function trainVertical(vertical: string): Promise<VerticalTrainingResult> {
  const label = VERTICAL_LABELS[vertical] ?? vertical;
  try {
    const existing = await getVerticalBenchmark(vertical);
    const benchmarkLine = existing?.benchmarkCpl
      ? `Our network benchmark CPL for this vertical is £${existing.benchmarkCpl.toFixed(2)} ` +
        `(sample size ${existing.sampleSize}). Calibrate your guidance against this.`
      : `We have no firm CPL benchmark for this vertical yet — give realistic UK ranges from your own experience.`;

    const rows = await scrapeAdLibrary(label);
    const adSummary = rows.length ? summariseAds(rows) : "";

    const brief = await writeExpertBrief(vertical, label, adSummary, benchmarkLine);
    if (!brief) {
      return { vertical, ok: false, briefChars: 0, adLibraryCount: rows.length, usedAdLibrary: rows.length > 0, note: "empty brief" };
    }

    const priorPerf = (existing?.performanceData && typeof existing.performanceData === "object" && !Array.isArray(existing.performanceData))
      ? (existing.performanceData as Record<string, unknown>)
      : {};

    await upsertVerticalBenchmark(vertical, {
      expertBrief: brief,
      performanceData: {
        ...priorPerf,
        lastTrainedAt:       new Date().toISOString(),
        adLibrarySampleSize: rows.length,
        trainingSource:      rows.length ? "ad_library+gpt" : "gpt_expert_knowledge",
      },
    });

    return { vertical, ok: true, briefChars: brief.length, adLibraryCount: rows.length, usedAdLibrary: rows.length > 0 };
  } catch (err) {
    console.error(`[verticalTrainer] trainVertical(${vertical}) failed:`, err instanceof Error ? err.message : err);
    return { vertical, ok: false, briefChars: 0, adLibraryCount: 0, usedAdLibrary: false, note: err instanceof Error ? err.message : "error" };
  }
}

/** Trains every known vertical, sequentially (rate-friendly). Never throws. */
export async function trainAllVerticals(): Promise<VerticalTrainingResult[]> {
  const results: VerticalTrainingResult[] = [];
  for (const vertical of Object.keys(VERTICAL_LABELS)) {
    results.push(await trainVertical(vertical));
  }
  return results;
}
