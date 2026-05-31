/**
 * src/lib/outreach/prospectImporter.ts
 * SERVER-SIDE ONLY. Parses an Apollo CSV export into OutreachProspect rows,
 * deduplicating by website domain (within the tenant). Pure parse + a persist
 * helper; the route supplies tenantId.
 *
 * Expected columns (case/space tolerant): First Name, Last Name, Company,
 * Website, City, Email. Unknown columns are ignored; rows missing Company AND
 * Website are skipped.
 */

import { prisma } from "@/lib/prisma";
import { sanitizeCompanyName } from "@/lib/outreach/nameSanitizer";
import { domainOf } from "@/lib/outreach/websiteText";

export interface ParsedRow {
  firstName:   string;
  lastName:    string;
  companyName: string;
  website:     string;
  location:    string;
  email:       string;
}

export interface ImportResult {
  imported:   number;
  duplicates: number;
  skipped:    number;
}

/** Splits one CSV line, honouring double-quoted fields with embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Normalises a header cell to a canonical key. */
function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, "");
}

const COLUMN_ALIASES: Record<string, keyof ParsedRow> = {
  firstname: "firstName",
  lastname:  "lastName",
  company:   "companyName",
  companyname: "companyName",
  organization: "companyName",
  website:   "website",
  websiteurl: "website",
  url:       "website",
  domain:    "website",
  city:      "location",
  location:  "location",
  email:     "email",
  emailaddress: "email",
};

/** Parses raw CSV text into rows. Never throws; returns [] on empty/garbage. */
export function parseApolloCsv(csv: string): ParsedRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(headerKey);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: ParsedRow = { firstName: "", lastName: "", companyName: "", website: "", location: "", email: "" };
    headers.forEach((h, idx) => {
      const key = COLUMN_ALIASES[h];
      if (key) row[key] = (cells[idx] ?? "").trim();
    });
    if (!row.companyName && !row.website) continue; // unusable
    rows.push(row);
  }
  return rows;
}

/**
 * Persists parsed rows as OutreachProspect records for a tenant, deduplicating by
 * website domain against existing rows AND within the same import batch. NEVER
 * THROWS at the top level (per-row failures are counted as skipped).
 */
export async function importProspects(tenantId: string, rows: ParsedRow[], vertical = "aesthetics"): Promise<ImportResult> {
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;

  // Existing domains for this tenant (one query).
  const existing = await prisma.outreachProspect
    .findMany({ where: { tenantId, websiteDomain: { not: null } }, select: { websiteDomain: true } })
    .catch(() => [] as { websiteDomain: string | null }[]);
  const seen = new Set(existing.map((e) => e.websiteDomain).filter((d): d is string => !!d));

  for (const row of rows) {
    const domain = domainOf(row.website);
    // Need at least a company name to be useful.
    if (!row.companyName && !domain) { skipped++; continue; }
    if (domain && seen.has(domain)) { duplicates++; continue; }
    if (domain) seen.add(domain);

    try {
      await prisma.outreachProspect.create({
        data: {
          tenantId,
          firstName:        row.firstName || null,
          lastName:         row.lastName || null,
          companyName:      row.companyName || domain || "(unknown)",
          cleanCompanyName: sanitizeCompanyName(row.companyName) || null,
          website:          row.website || "",
          websiteDomain:    domain,
          location:         row.location || null,
          contactEmail:     row.email || null,
          vertical,
          source:           "apollo_csv",
          status:           "pending",
        },
      });
      imported++;
    } catch (err) {
      console.error("[prospectImporter] row failed:", err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  return { imported, duplicates, skipped };
}
