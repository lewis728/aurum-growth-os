/**
 * src/lib/services/metaAdLibrary.ts
 * SERVER-SIDE ONLY. Thin, graceful, SELF-CONTAINED wrapper over the Meta Ad
 * Library (`ads_archive`). Shared by the Vertical Trainer (Sprint 13) and
 * Competitor Intelligence (Sprint 15).
 *
 * The Ad Library is a public endpoint but still requires a Meta token. We keep it
 * on its own env var (`META_ADLIBRARY_TOKEN`) so it's independent of the
 * per-tenant ads tokens. When the token is absent (Meta app pending approval),
 * every call returns [] and callers fall back to expert knowledge — never throws.
 */

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

export interface AdArchiveRow {
  ad_creative_bodies?:        string[];
  ad_creative_link_titles?:   string[];
  ad_creative_link_captions?: string[];
  publisher_platforms?:       string[];
  page_name?:                 string;
}

export function adLibraryConfigured(): boolean {
  return Boolean(process.env.META_ADLIBRARY_TOKEN);
}

/**
 * Searches live ads matching `searchTerms` in the given country (default GB).
 * Returns [] on missing token or any failure — never throws.
 */
export async function searchAdLibrary(
  searchTerms: string,
  opts?: { country?: string; limit?: number },
): Promise<AdArchiveRow[]> {
  const token = process.env.META_ADLIBRARY_TOKEN;
  if (!token || !searchTerms.trim()) return [];
  try {
    const url = new URL(`${GRAPH_BASE}/ads_archive`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("search_terms", searchTerms);
    url.searchParams.set("ad_reached_countries", JSON.stringify([opts?.country ?? "GB"]));
    url.searchParams.set("ad_active_status", "ACTIVE");
    url.searchParams.set("ad_type", "ALL");
    url.searchParams.set("fields", "ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,publisher_platforms,page_name");
    url.searchParams.set("limit", String(opts?.limit ?? 40));

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[metaAdLibrary] HTTP ${res.status} for "${searchTerms}": ${text.slice(0, 160)}`);
      return [];
    }
    const data = (await res.json()) as { data?: AdArchiveRow[] };
    return data.data ?? [];
  } catch (err) {
    console.error(`[metaAdLibrary] search failed for "${searchTerms}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

/** Returns up to `max` compact one-line summaries (used for prompts and UI previews). */
export function compactAdLines(rows: AdArchiveRow[], max = 40): string[] {
  return rows
    .map((r, i) => {
      const body = (r.ad_creative_bodies ?? []).join(" ").replace(/\s+/g, " ").trim().slice(0, 220);
      const title = (r.ad_creative_link_titles ?? []).join(" ").trim().slice(0, 100);
      const platforms = (r.publisher_platforms ?? []).join("/");
      const page = (r.page_name ?? "").trim();
      if (!body && !title) return null;
      const who = page ? `${page}: ` : "";
      return `${i + 1}. [${platforms || "?"}] ${who}${title ? `"${title}" — ` : ""}${body}`;
    })
    .filter((l): l is string => l !== null)
    .slice(0, max);
}

/** Compresses raw ad rows into short, readable lines a model can reason over. */
export function summariseAds(rows: AdArchiveRow[], max = 40): string {
  return compactAdLines(rows, max).join("\n");
}
