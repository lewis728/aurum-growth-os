/**
 * src/lib/leads/sourcing.ts
 * SERVER-SIDE ONLY. The "find the businesses" step — sources real local businesses
 * (name, website, phone, address, and crucially RATING + REVIEW COUNT for the ICP)
 * from Google Maps via Outscraper. Provider-agnostic seam; GRACEFUL — with no key it
 * returns [] and the runner reports "not configured". NEVER THROWS.
 *
 * Why Google Maps: it gives the exact ICP signals for local trades — a real website,
 * a phone, and the review count/rating that prove an established, in-demand operator.
 */

import { withRetry, isTransientError } from "@/lib/utils/withRetry";

export interface SourcedBusiness {
  name:        string;
  website:     string | null;
  phone:       string | null;
  city:        string | null;
  address:     string | null;
  rating:      number | null;
  reviewCount: number | null;
  email:       string | null;   // some Outscraper plans return an on-site email
}

function provider(): string {
  return (process.env.LEAD_SOURCE_PROVIDER ?? "outscraper").trim().toLowerCase();
}

export function sourcingConfigured(): boolean {
  if (provider() === "outscraper") return Boolean(process.env.OUTSCRAPER_API_KEY);
  return false;
}

interface OutscraperRow {
  name?: string;
  site?: string;
  phone?: string;
  city?: string;
  full_address?: string;
  rating?: number | string;
  reviews?: number | string;
  email_1?: string;
}
interface OutscraperResponse { data?: OutscraperRow[][] | OutscraperRow[] }

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function sourceOutscraper(query: string, limit: number): Promise<SourcedBusiness[]> {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key) return [];
  const url =
    `https://api.outscraper.com/maps/search-v3?query=${encodeURIComponent(query)}` +
    `&limit=${Math.max(1, Math.min(limit, 500))}&language=en&region=GB&async=false`;

  const data = await withRetry(
    async () => {
      const res = await fetch(url, { method: "GET", headers: { "X-API-KEY": key } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OutscraperResponse;
    },
    { maxAttempts: 3, baseDelayMs: 1500, label: "sourcing.outscraper", shouldRetry: isTransientError },
  );

  // Outscraper returns data as an array (one entry per query) of arrays of rows.
  const raw = data.data ?? [];
  const rows: OutscraperRow[] = Array.isArray(raw[0]) ? (raw[0] as OutscraperRow[]) : (raw as OutscraperRow[]);
  return rows
    .filter((r): r is OutscraperRow => Boolean(r && r.name))
    .map((r) => ({
      name:        (r.name ?? "").trim(),
      website:     r.site?.trim() || null,
      phone:       r.phone?.trim() || null,
      city:        r.city?.trim() || null,
      address:     r.full_address?.trim() || null,
      rating:      num(r.rating),
      reviewCount: num(r.reviews),
      email:       r.email_1?.trim() || null,
    }));
}

/**
 * Sources businesses for a Google-Maps-style query (e.g. "roofers in Dorset").
 * Returns [] if no provider is configured or on failure. NEVER THROWS.
 */
export async function sourceBusinesses(query: string, limit = 100): Promise<SourcedBusiness[]> {
  try {
    if (!query.trim()) return [];
    if (provider() === "outscraper") return await sourceOutscraper(query, limit);
    return [];
  } catch (err) {
    console.error("[sourcing] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
