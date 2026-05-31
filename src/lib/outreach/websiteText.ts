/**
 * src/lib/outreach/websiteText.ts
 * SERVER-SIDE ONLY. Fetches a prospect website and strips it to a plain-text
 * sample for the qualifier + hook writer. Mirrors the proven scrape logic in
 * clients/scrape-website/route.ts, packaged as a reusable, never-throws function.
 */

const FETCH_TIMEOUT_MS = 9000;
const MAX_CHARS = 4000;

// SSRF guard: block loopback / link-local / private / metadata ranges so a
// user-supplied prospect URL can't be used to probe internal services or the
// cloud metadata endpoint (169.254.169.254). Hostnames that are literal private
// IPs or localhost variants are rejected outright.
const BLOCKED_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,                         // 127.0.0.0/8 loopback
  /^0\./,                           // 0.0.0.0/8
  /^10\./,                          // 10.0.0.0/8 private
  /^192\.168\./,                    // 192.168.0.0/16 private
  /^169\.254\./,                    // link-local (incl. cloud metadata)
  /^172\.(1[6-9]|2\d|3[01])\./,     // 172.16.0.0/12 private
  /^::1$/,                          // IPv6 loopback
  /^\[?::1\]?$/,
  /^f[cd][0-9a-f]{2}:/i,            // IPv6 unique-local fc00::/7
  /^fe80:/i,                        // IPv6 link-local
];

function isBlockedHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return BLOCKED_HOST.some((re) => re.test(h));
}

/** Normalises a user-supplied URL to a fetchable https origin, or null. */
export function normaliseUrl(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && !u.hostname.includes(":")) return null; // must look like a domain
    if (isBlockedHost(u.hostname)) return null; // SSRF: no internal/private targets
    return u.toString();
  } catch {
    return null;
  }
}

/** Bare registrable host (no protocol/www) — used as the dedup key. */
export function domainOf(raw: string): string | null {
  const url = normaliseUrl(raw);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
}

/**
 * Fetches + strips a website to plain text. NEVER THROWS — returns "" on any
 * failure (bad URL, timeout, non-200, no readable content), so callers degrade
 * gracefully and let GPT work from whatever signal exists.
 */
export async function fetchWebsiteText(rawUrl: string): Promise<string> {
  const url = normaliseUrl(rawUrl);
  if (!url) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AurumBot/1.0)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return "";
    return stripHtml(await res.text());
  } catch {
    return "";
  }
}
