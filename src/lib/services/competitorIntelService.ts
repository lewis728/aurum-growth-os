/**
 * src/lib/services/competitorIntelService.ts
 * SERVER-SIDE ONLY.
 *
 * ── COMPETITOR INTELLIGENCE (Sprint 15) ─────────────────────────────────────
 * Weekly, per LIVE client, scans the Meta Ad Library for competitors in the
 * client's geography + vertical, then asks GPT-4o what's working for them and
 * where the gaps are. Stores a rolling window of the last 4 weekly snapshots on
 * `ClientBrief.competitorIntel` (newest first). The Friday morning briefing folds
 * in the latest snapshot, and the client sub-account renders it in a panel.
 *
 * GRACEFUL: the Ad Library needs `META_ADLIBRARY_TOKEN` (Meta app pending). When
 * it's unset or returns nothing, the scan records a snapshot noting no live ads
 * were observed rather than inventing competitors. NEVER THROWS.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchAdLibrary, compactAdLines, type AdArchiveRow } from "@/lib/services/metaAdLibrary";

import { openai } from "@/lib/services/openaiClient";

const MAX_SNAPSHOTS = 4;          // keep the last 4 weeks
const MAX_SEARCH_TERMS = 4;       // cap ad-library calls per scan
const ADS_PER_TERM = 15;
const MAX_SAMPLE_ADS = 12;        // stored on the snapshot for the UI

export interface CompetitorSnapshot {
  weekOf:          string;   // ISO date (start of the scan)
  competitorCount: number;   // distinct advertiser pages seen
  adCount:         number;   // total live ads sampled
  summary:         string;   // GPT-4o plain-English read of the competitive picture
  whatsWorking:    string[]; // angles/formats competitors are leaning on
  gaps:            string[]; // openings this client can exploit
  sampleAds:       string[]; // compact one-line ad summaries (for the panel)
  usedAdLibrary:   boolean;  // false when no token / no ads (analysis is advisory)
}

export interface CompetitorScanResult {
  blueprintId: string;
  ok:          boolean;
  snapshot?:   CompetitorSnapshot;
  note?:       string;
}

/** Parses the free-text competitorNames field into clean search terms. */
function parseCompetitorNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, MAX_SEARCH_TERMS);
}

/** Coerces stored JSON into a clean snapshot array (newest first). */
function parseSnapshots(raw: unknown): CompetitorSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is CompetitorSnapshot => !!s && typeof s === "object" && typeof (s as CompetitorSnapshot).weekOf === "string");
}

interface CompetitorAnalysis {
  summary:      string;
  whatsWorking: string[];
  gaps:         string[];
}

async function analyseCompetitors(
  businessName: string,
  label: string,
  location: string,
  adLines: string[],
): Promise<CompetitorAnalysis> {
  const system =
    `You are a senior paid-social strategist. You analyse competitor advertising and ` +
    `brief the team running ${businessName}, a ${label} business in ${location}. ` +
    `Be concrete and specific. Never invent ads that aren't in the data.`;

  const user = [
    adLines.length
      ? `Here are live competitor ads currently running in ${location} for the ${label} market (Meta Ad Library sample):\n${adLines.join("\n")}`
      : `No live competitor ads were retrievable this week for the ${label} market in ${location}. Give your best strategic read from expert knowledge of this vertical, and say plainly that it is not based on a live sample.`,
    ``,
    `Return STRICT JSON only, no prose, with this shape:`,
    `{"summary": string (2-3 sentences on the competitive picture), "whatsWorking": string[] (3-5 concrete angles/formats/offers competitors lean on), "gaps": string[] (3-5 specific openings ${businessName} can exploit)}`,
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model:           "gpt-4o",
    temperature:     0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
  const parsed = JSON.parse(raw) as Partial<CompetitorAnalysis>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  return {
    summary:      typeof parsed.summary === "string" ? parsed.summary : "",
    whatsWorking: arr(parsed.whatsWorking),
    gaps:         arr(parsed.gaps),
  };
}

/**
 * Runs one competitor scan for a client and stores the snapshot. NEVER THROWS.
 */
export async function runCompetitorScan(
  blueprintId: string,
  tenantId: string,
): Promise<CompetitorScanResult> {
  try {
    const blueprint = await prisma.campaignBlueprint.findFirst({
      where:  { id: blueprintId, tenantId },
      select: { businessName: true, vertical: true, targetLocation: true },
    });
    if (!blueprint) return { blueprintId, ok: false, note: "blueprint not found" };

    const [brief, profile] = await Promise.all([
      prisma.clientBrief.findUnique({
        where:  { blueprintId },
        select: { competitorNames: true, competitorIntel: true },
      }),
      prisma.verticalProfile.findUnique({
        where:  { vertical: blueprint.vertical },
        select: { displayName: true },
      }),
    ]);

    const label    = profile?.displayName || blueprint.vertical;
    const location = blueprint.targetLocation || "the UK";

    // Search terms: explicit competitor names first, else vertical + location.
    const named = parseCompetitorNames(brief?.competitorNames);
    const terms = named.length ? named : [`${label} ${location}`];

    // Gather live ads across the search terms (deduped by page+body).
    const rows: AdArchiveRow[] = [];
    const seen = new Set<string>();
    for (const term of terms.slice(0, MAX_SEARCH_TERMS)) {
      const found = await searchAdLibrary(term, { country: "GB", limit: ADS_PER_TERM });
      for (const r of found) {
        const key = `${r.page_name ?? ""}|${(r.ad_creative_bodies ?? []).join(" ").slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(r);
      }
    }

    const pages = new Set(rows.map((r) => (r.page_name ?? "").trim()).filter(Boolean));
    const adLines = compactAdLines(rows, MAX_SAMPLE_ADS);

    const analysis = await analyseCompetitors(blueprint.businessName, label, location, adLines);

    const snapshot: CompetitorSnapshot = {
      weekOf:          new Date().toISOString(),
      competitorCount: pages.size,
      adCount:         rows.length,
      summary:         analysis.summary,
      whatsWorking:    analysis.whatsWorking,
      gaps:            analysis.gaps,
      sampleAds:       adLines,
      usedAdLibrary:   rows.length > 0,
    };

    // Prepend, keep last 4. Upsert so an un-briefed client still records intel.
    const history = [snapshot, ...parseSnapshots(brief?.competitorIntel)].slice(0, MAX_SNAPSHOTS);
    await prisma.clientBrief.upsert({
      where:  { blueprintId },
      create: { blueprintId, tenantId, competitorIntel: history as unknown as Prisma.InputJsonValue },
      update: { competitorIntel: history as unknown as Prisma.InputJsonValue },
    });

    return { blueprintId, ok: true, snapshot };
  } catch (err) {
    console.error(`[competitorIntel] scan failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { blueprintId, ok: false, note: err instanceof Error ? err.message : "error" };
  }
}

/** Scans every LIVE blueprint. Never throws. */
export async function runCompetitorScanAllLive(): Promise<CompetitorScanResult[]> {
  const blueprints = await prisma.campaignBlueprint
    .findMany({ where: { status: "live" }, select: { id: true, tenantId: true } })
    .catch(() => [] as { id: string; tenantId: string }[]);

  const results: CompetitorScanResult[] = [];
  for (const bp of blueprints) {
    results.push(await runCompetitorScan(bp.id, bp.tenantId));
  }
  return results;
}

/** Returns the latest stored snapshot for a client (or null). Read-only helper. */
export async function latestCompetitorSnapshot(blueprintId: string): Promise<CompetitorSnapshot | null> {
  const brief = await prisma.clientBrief
    .findUnique({ where: { blueprintId }, select: { competitorIntel: true } })
    .catch(() => null);
  return parseSnapshots(brief?.competitorIntel)[0] ?? null;
}
