/**
 * src/lib/services/prospectResearchService.ts
 * SERVER-SIDE ONLY.
 *
 * ── PROSPECT RESEARCH (Sprint 17) ───────────────────────────────────────────
 * The "win new clients" engine. Given a prospect's website + company name, it:
 *   1. Fetches and strips their website to a readable text sample (self-contained;
 *      no scrape dependency — plain fetch + tag strip, never throws).
 *   2. Checks the Meta Ad Library for ads they (or their vertical) are running.
 *   3. Asks GPT-4o to infer the vertical, summarise the business, and write a
 *      tailored 90-day growth proposal the agency owner can present like a
 *      £5,000 strategy session.
 *   4. Persists everything to ProspectResearch for later viewing/export.
 *
 * GRACEFUL: website fetch failures and a missing Ad Library token (Meta pending)
 * degrade to "no live data" rather than failing — GPT still writes the proposal
 * from whatever signal exists. NEVER THROWS at the top level.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchAdLibrary, compactAdLines } from "@/lib/services/metaAdLibrary";

import { openai } from "@/lib/services/openaiClient";

const FETCH_TIMEOUT_MS = 8000;
const MAX_SITE_CHARS = 6000;
const MAX_SAMPLE_ADS = 10;

export interface ProspectResearchInput {
  companyName: string;
  websiteUrl:  string;
  location?:   string;
}

export interface ProspectResearchRecord {
  id:                 string;
  companyName:        string;
  websiteUrl:         string;
  vertical:           string | null;
  location:           string | null;
  websiteSummary:     string | null;
  competitorFindings: { adCount: number; sampleAds: string[]; usedAdLibrary: boolean } | null;
  proposal:           string | null;
  status:             string;
  createdAt:          string;
}

/** Normalises a user-supplied URL to an https origin we can fetch. */
function normaliseUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Strips HTML to a compact readable text sample. Never throws; "" on failure. */
async function fetchSiteText(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AurumResearchBot/1.0)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, MAX_SITE_CHARS);
  } catch {
    return "";
  }
}

interface ProposalOutput {
  vertical:       string;
  websiteSummary: string;
  proposal:       string;
}

async function generateProposal(
  companyName: string,
  location: string,
  siteText: string,
  adLines: string[],
): Promise<ProposalOutput> {
  const system =
    `You are the founder of an elite AI-powered marketing agency pitching a new ` +
    `prospect. You write proposals that look like a £5,000 strategy session — ` +
    `specific, confident, commercially sharp. You never pad or hedge.`;

  const user = [
    `Prospect: ${companyName}${location ? ` (${location})` : ""}.`,
    ``,
    siteText
      ? `Their website content (extracted):\n${siteText}`
      : `Their website could not be read this time — infer what you can from the company name.`,
    ``,
    adLines.length
      ? `Live ads currently running in their market (Meta Ad Library):\n${adLines.join("\n")}`
      : `No live competitor ads were retrievable. Note this and proceed from expertise.`,
    ``,
    `Return STRICT JSON only with this shape:`,
    `{`,
    `  "vertical": string (your best single-label classification of their business, e.g. "aesthetics", "roofing", "dental"),`,
    `  "websiteSummary": string (2-3 sentences on what they do and who they serve),`,
    `  "proposal": string (a tailored 90-day growth proposal in markdown, with these sections: `,
    `     "## Where you are now", "## The opportunity", "## The 90-day plan" (broken into Days 1-30 / 31-60 / 61-90 with concrete actions), `,
    `     "## What an AI fulfilment team does for you" (Sophie calls leads in 60s, Marcus runs the ads, James books, Ava reports, Kai learns), `,
    `     and "## Projected impact" (realistic, caveated ranges — never fabricate exact numbers). Be specific to THIS business.)`,
    `}`,
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model:           "gpt-4o",
    temperature:     0.5,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
  const parsed = JSON.parse(raw) as Partial<ProposalOutput>;
  return {
    vertical:       typeof parsed.vertical === "string" ? parsed.vertical : "general",
    websiteSummary: typeof parsed.websiteSummary === "string" ? parsed.websiteSummary : "",
    proposal:       typeof parsed.proposal === "string" ? parsed.proposal : "",
  };
}

function serialise(row: {
  id: string; companyName: string; websiteUrl: string; vertical: string | null;
  location: string | null; websiteSummary: string | null; competitorFindings: unknown;
  proposal: string | null; status: string; createdAt: Date;
}): ProspectResearchRecord {
  const cf = row.competitorFindings;
  return {
    id:                 row.id,
    companyName:        row.companyName,
    websiteUrl:         row.websiteUrl,
    vertical:           row.vertical,
    location:           row.location,
    websiteSummary:     row.websiteSummary,
    competitorFindings: cf && typeof cf === "object" ? (cf as ProspectResearchRecord["competitorFindings"]) : null,
    proposal:           row.proposal,
    status:             row.status,
    createdAt:          row.createdAt.toISOString(),
  };
}

/**
 * Runs the full research pipeline and persists the result. NEVER THROWS — on a
 * hard failure it records a `failed` row so the UI can show the error state.
 */
export async function runProspectResearch(
  tenantId: string,
  input: ProspectResearchInput,
): Promise<ProspectResearchRecord> {
  const companyName = input.companyName.trim().slice(0, 160);
  const url = normaliseUrl(input.websiteUrl);
  const location = (input.location ?? "").trim().slice(0, 120) || "the UK";

  if (!companyName || !url) {
    const failed = await prisma.prospectResearch.create({
      data: {
        tenantId, companyName: companyName || "(unknown)", websiteUrl: input.websiteUrl.slice(0, 300),
        location, status: "failed",
        proposal: "Research could not run: a valid company name and website URL are required.",
      },
    });
    return serialise(failed);
  }

  try {
    // 1. Website text + 2. competitor ads, in parallel.
    const siteText = await fetchSiteText(url);

    // First-pass: search the Ad Library by company name (their own ads).
    const ownAds = await searchAdLibrary(companyName, { country: "GB", limit: 15 });
    const adLines = compactAdLines(ownAds, MAX_SAMPLE_ADS);

    // 3. Proposal.
    const out = await generateProposal(companyName, location, siteText, adLines);

    const competitorFindings = {
      adCount:       ownAds.length,
      sampleAds:     adLines,
      usedAdLibrary: ownAds.length > 0,
    };

    const row = await prisma.prospectResearch.create({
      data: {
        tenantId,
        companyName,
        websiteUrl:         url,
        vertical:           out.vertical || null,
        location,
        websiteSummary:     out.websiteSummary || null,
        competitorFindings: competitorFindings as unknown as Prisma.InputJsonValue,
        proposal:           out.proposal || null,
        status:             "complete",
      },
    });
    return serialise(row);
  } catch (err) {
    console.error(`[prospectResearch] failed for ${companyName}:`, err instanceof Error ? err.message : err);
    const failed = await prisma.prospectResearch.create({
      data: {
        tenantId, companyName, websiteUrl: url, location, status: "failed",
        proposal: "Research could not be completed. Please try again.",
      },
    }).catch(() => null);
    return failed
      ? serialise(failed)
      : {
          id: "", companyName, websiteUrl: url, vertical: null, location,
          websiteSummary: null, competitorFindings: null,
          proposal: "Research could not be completed.", status: "failed",
          createdAt: new Date().toISOString(),
        };
  }
}

/** Lists a tenant's prior research, newest first. */
export async function listProspectResearch(tenantId: string, limit = 20): Promise<ProspectResearchRecord[]> {
  const rows = await prisma.prospectResearch
    .findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit })
    .catch(() => []);
  return rows.map(serialise);
}

/** Fetches one research record, tenant-scoped. */
export async function getProspectResearch(tenantId: string, id: string): Promise<ProspectResearchRecord | null> {
  const row = await prisma.prospectResearch.findFirst({ where: { id, tenantId } }).catch(() => null);
  return row ? serialise(row) : null;
}
