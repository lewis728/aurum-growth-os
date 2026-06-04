/**
 * src/lib/leads/companiesHouse.ts
 * SERVER-SIDE ONLY. The FREE universe — pulls every UK roofing company from the
 * official Companies House register (Advanced Search by SIC code) + the
 * director/owner NAMES (Officers API). This is the complete spine no paid tool has.
 *
 * Auth: HTTP Basic with the API key as the username and an empty password.
 * Rate limit: 600 requests / 5 min → we space requests. NEVER THROWS (returns []).
 */

import { withRetry, isTransientError } from "@/lib/utils/withRetry";

const CH_BASE = "https://api.company-information.service.gov.uk";

// Roofing-relevant SIC codes. 43910 = "Roofing activities" (the core); the others
// catch roofers filed under broader construction codes.
export const ROOFING_SIC_CODES = ["43910", "43999", "43390"];

export function companiesHouseConfigured(): boolean {
  return Boolean(process.env.COMPANIES_HOUSE_API_KEY);
}

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CHCompany {
  companyNumber: string;
  companyName:   string;
  status:        string;
  incorporated:  string | null;
  locality:      string | null;
  region:        string | null;
  postcode:      string | null;
  sicCodes:      string[];
}

interface CHAdvancedItem {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  date_of_creation?: string;
  registered_office_address?: { locality?: string; region?: string; postal_code?: string };
  sic_codes?: string[];
}
interface CHAdvancedResponse { hits?: number; items?: CHAdvancedItem[] }

async function chGet<T>(pathWithQuery: string): Promise<T> {
  return withRetry(
    async () => {
      const res = await fetch(`${CH_BASE}${pathWithQuery}`, { headers: { Authorization: authHeader(), Accept: "application/json" } });
      if (res.status === 429) throw new Error("HTTP 429"); // rate limited → retry/backoff
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    { maxAttempts: 4, baseDelayMs: 2000, label: "companiesHouse.get", shouldRetry: isTransientError },
  );
}

/**
 * Pulls active roofing companies by SIC code(s). Paginates (size 100). The Advanced
 * Search API caps retrievable results, so for SIC sets exceeding the cap we de-dupe
 * across codes; `onPage` lets the caller stream rows to a CSV as they arrive.
 * Returns the deduped list. NEVER THROWS.
 */
export async function searchRoofingCompanies(opts?: {
  sicCodes?: string[];
  status?: string;
  max?: number;
  onPage?: (rows: CHCompany[]) => void | Promise<void>;
}): Promise<CHCompany[]> {
  if (!companiesHouseConfigured()) return [];
  const sicCodes = opts?.sicCodes ?? ROOFING_SIC_CODES;
  const status = opts?.status ?? "active";
  const max = opts?.max ?? 100_000;
  const seen = new Set<string>();
  const out: CHCompany[] = [];

  for (const sic of sicCodes) {
    let start = 0;
    const size = 100;
    for (;;) {
      if (out.length >= max) return out;
      let data: CHAdvancedResponse;
      try {
        data = await chGet<CHAdvancedResponse>(
          `/advanced-search/companies?sic_codes=${encodeURIComponent(sic)}&company_status=${encodeURIComponent(status)}&size=${size}&start_index=${start}`,
        );
      } catch (err) {
        console.error(`[companiesHouse] search ${sic}@${start} failed:`, err instanceof Error ? err.message : err);
        break;
      }
      const items = data.items ?? [];
      if (items.length === 0) break;

      const page: CHCompany[] = [];
      for (const it of items) {
        const number = it.company_number ?? "";
        if (!number || seen.has(number)) continue;
        seen.add(number);
        const c: CHCompany = {
          companyNumber: number,
          companyName:   (it.company_name ?? "").trim(),
          status:        it.company_status ?? "",
          incorporated:  it.date_of_creation ?? null,
          locality:      it.registered_office_address?.locality ?? null,
          region:        it.registered_office_address?.region ?? null,
          postcode:      it.registered_office_address?.postal_code ?? null,
          sicCodes:      it.sic_codes ?? [],
        };
        page.push(c); out.push(c);
        if (out.length >= max) break;
      }
      if (page.length && opts?.onPage) await opts.onPage(page);

      start += size;
      // Advanced Search caps how deep you can page; stop at the documented ceiling.
      if (start >= 9900 || start >= (data.hits ?? 0)) break;
      await sleep(250); // stay well under 600 req / 5 min
    }
  }
  return out;
}

interface CHOfficerItem { name?: string; officer_role?: string; resigned_on?: string }
interface CHOfficersResponse { items?: CHOfficerItem[] }

/** Title-cases Companies House's "SURNAME, Firstname" into {firstName,lastName}. */
function parseOfficerName(raw: string): { firstName: string | null; lastName: string | null } {
  const tc = (s: string) => s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).trim();
  const parts = raw.split(",");
  if (parts.length >= 2) {
    const lastName = tc(parts[0]);
    const firstName = tc((parts[1].trim().split(/\s+/)[0]) ?? "");
    return { firstName: firstName || null, lastName: lastName || null };
  }
  const first = tc(raw.split(/\s+/)[0] ?? "");
  return { firstName: first || null, lastName: null };
}

/**
 * The primary active DIRECTOR (the owner/decision-maker) for a company. Picks the
 * earliest-appointed, non-resigned director. Returns null if none / unavailable.
 * NEVER THROWS.
 */
export async function getPrimaryDirector(companyNumber: string): Promise<{ firstName: string | null; lastName: string | null } | null> {
  if (!companiesHouseConfigured() || !companyNumber) return null;
  try {
    const data = await chGet<CHOfficersResponse>(`/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=35`);
    const directors = (data.items ?? []).filter(
      (o) => !o.resigned_on && /director/i.test(o.officer_role ?? "") && o.name,
    );
    if (directors.length === 0) return null;
    return parseOfficerName(directors[0].name as string);
  } catch (err) {
    console.error(`[companiesHouse] officers ${companyNumber} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
