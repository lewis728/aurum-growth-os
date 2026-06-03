/**
 * scripts/onboard-research.ts  (onboard-roofer skill — Step 2)
 *
 * Builds a research dossier for a roofing client: scrapes their site, pulls their
 * own live ads + local roofing competitors from the Meta Ad Library, and surfaces
 * basic signals (phone, reviews). Prints JSON to stdout for the skill to reason over.
 *
 * Read-only. NEVER THROWS — degrades to nulls/empty when a source is unavailable.
 * Run: npm run onboard:research -- --name "Apex Roofing" --website "https://..." --city "Leeds"
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { fetchWebsiteText } from "../src/lib/outreach/websiteText";
import { searchAdLibrary, summariseAds, adLibraryConfigured, type AdArchiveRow } from "../src/lib/services/metaAdLibrary";

function parseArgs(argv: string[]): { opts: Record<string, string> } {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith("--")) { opts[k] = n; i++; }
    }
  }
  return { opts };
}

const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/;
const REVIEW_COUNT_RE = /([\d,]{1,6})\s*(?:google\s*)?reviews?/i;
const RATING_RE = /\b([0-5](?:\.\d)?)\s*(?:\/\s*5|stars?|out of 5)/i;

interface Dossier {
  name: string;
  website: string;
  city: string;
  adLibraryConfigured: boolean;
  websiteExcerpt: string;
  signals: { hasPhone: boolean; reviewCount: number | null; reviewRating: number | null };
  ownAdsRunning: boolean;
  ownAds: string;
  competitorsAdvertising: number;
  competitorAds: string;
}

async function safeAds(query: string, country: string, limit: number): Promise<AdArchiveRow[]> {
  try { return await searchAdLibrary(query, { country, limit }); }
  catch (err) { console.error(`[research] ad library "${query}" failed:`, err instanceof Error ? err.message : err); return []; }
}

async function main(): Promise<void> {
  const { opts } = parseArgs(process.argv.slice(2));
  const name = (opts.name ?? "").trim();
  const website = (opts.website ?? "").trim();
  const city = (opts.city ?? "").trim();
  const country = (opts.country ?? "GB").trim().toUpperCase() || "GB";
  // Niche label for the local-competitor Ad Library search (roofing | home improvement).
  const nicheLabel = ((opts.niche ?? "roofing").trim().toLowerCase().includes("home"))
    ? "home improvement"
    : "roofing";

  if (!name) { console.error("ERROR: --name is required"); process.exit(1); }

  let websiteText = "";
  if (website) {
    try { websiteText = await fetchWebsiteText(website); }
    catch (err) { console.error("[research] scrape failed:", err instanceof Error ? err.message : err); }
  }

  const rc = websiteText.match(REVIEW_COUNT_RE);
  const rr = websiteText.match(RATING_RE);
  const reviewCount = rc ? Number.parseInt(rc[1].replace(/,/g, ""), 10) : null;
  const reviewRating = rr ? Number.parseFloat(rr[1]) : null;

  const ownAds = await safeAds(name, country, 8);
  const competitors = city ? await safeAds(`${city} ${nicheLabel}`, country, 12) : [];

  const dossier: Dossier = {
    name, website, city,
    adLibraryConfigured: adLibraryConfigured(),
    websiteExcerpt: websiteText.slice(0, 1500),
    signals: {
      hasPhone: PHONE_RE.test(websiteText),
      reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
      reviewRating: reviewRating != null && reviewRating <= 5 ? reviewRating : null,
    },
    ownAdsRunning: ownAds.length > 0,
    ownAds: ownAds.length ? summariseAds(ownAds, 8) : "(none found / ad library not configured)",
    competitorsAdvertising: competitors.length,
    competitorAds: competitors.length ? summariseAds(competitors, 12) : "(none found / ad library not configured)",
  };

  console.log(JSON.stringify(dossier, null, 2));
}

main().catch((err) => {
  console.error("onboard:research FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
