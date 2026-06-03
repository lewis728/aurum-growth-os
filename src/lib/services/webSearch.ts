/**
 * src/lib/services/webSearch.ts
 * SERVER-SIDE ONLY. A graceful live-web-search seam so agents can research the
 * real world at decision time (competitor promos, weather events, local news that
 * explains a sudden CPL/CTR move) — the thing a human buyer can't do mid-decision.
 *
 * Provider-agnostic: OUTREACH... no — OPTIMISATION_SEARCH provider via env. Default
 * "serper" (google.serper.dev). GRACEFUL: with no key it returns null and callers
 * carry on — research is an enhancement, never a dependency. NEVER THROWS.
 */

import { withRetry, isTransientError } from "@/lib/utils/withRetry";

export interface WebResult { title: string; snippet: string; link?: string }

function provider(): string {
  return (process.env.WEB_SEARCH_PROVIDER ?? "serper").trim().toLowerCase();
}

/** True when a web-search provider + key are configured. */
export function webSearchConfigured(): boolean {
  if (provider() === "serper") return Boolean(process.env.SERPER_API_KEY);
  if (provider() === "tavily") return Boolean(process.env.TAVILY_API_KEY);
  return false;
}

interface SerperOrganic { title?: string; snippet?: string; link?: string }
interface SerperResponse { organic?: SerperOrganic[] }
interface TavilyResult { title?: string; content?: string; url?: string }
interface TavilyResponse { results?: TavilyResult[] }

async function searchSerper(query: string, max: number): Promise<WebResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  const data = await withRetry(
    async () => {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: max, gl: "gb" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SerperResponse;
    },
    { maxAttempts: 2, baseDelayMs: 500, label: "webSearch.serper", shouldRetry: isTransientError },
  );
  return (data.organic ?? []).slice(0, max).map((o) => ({ title: o.title ?? "", snippet: o.snippet ?? "", link: o.link }));
}

async function searchTavily(query: string, max: number): Promise<WebResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const data = await withRetry(
    async () => {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, query, max_results: max, search_depth: "basic" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TavilyResponse;
    },
    { maxAttempts: 2, baseDelayMs: 500, label: "webSearch.tavily", shouldRetry: isTransientError },
  );
  return (data.results ?? []).slice(0, max).map((r) => ({ title: r.title ?? "", snippet: r.content ?? "", link: r.url }));
}

/** Searches the live web. Returns [] if no provider configured or on failure. NEVER THROWS. */
export async function webSearch(query: string, max = 5): Promise<WebResult[]> {
  try {
    if (!query.trim()) return [];
    if (provider() === "serper") return await searchSerper(query, max);
    if (provider() === "tavily") return await searchTavily(query, max);
    return [];
  } catch (err) {
    console.error("[webSearch] failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Compact the results into a few readable lines for an evidence pack. */
export function compactWebResults(rows: WebResult[], max = 5): string {
  if (rows.length === 0) return "";
  return rows.slice(0, max).map((r) => `- ${r.title}: ${r.snippet}`.slice(0, 300)).join("\n");
}
