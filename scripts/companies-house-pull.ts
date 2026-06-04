/**
 * scripts/companies-house-pull.ts  (npm run leads:ch)
 *
 * Pulls EVERY active UK roofing company from the official Companies House register
 * (Advanced Search by SIC code) into a CSV — the free, complete universe. Optionally
 * (--with-officers) also fetches the director/owner NAME per company (slower, more
 * API calls). Runs on the FREE Companies House key alone — no paid tools needed.
 *
 * The CSV is then the input to `leads:build --csv <file>` (domain → owner email via
 * waterfall → verify → qualify → personalise → store).
 *
 * Run:
 *   npm run leads:ch                                   # all roofing SICs → ./tmp/uk-roofers.csv
 *   npm run leads:ch -- --with-officers --out ./tmp/uk-roofers.csv
 *   npm run leads:ch -- --sic 43910 --max 500          # one SIC, capped (test)
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { searchRoofingCompanies, getPrimaryDirector, companiesHouseConfigured, ROOFING_SIC_CODES, type CHCompany } from "../src/lib/leads/companiesHouse";

function parseArgs(argv: string[]): { opts: Record<string, string>; flags: Set<string> } {
  const opts: Record<string, string> = {}; const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const n = argv[i + 1]; if (n && !n.startsWith("--")) { opts[k] = n; i++; } else flags.add(k); }
  }
  return { opts, flags };
}

const csvField = (v: string | null): string => `"${(v ?? "").replace(/"/g, '""')}"`;
const HEADER = ["companyNumber", "companyName", "status", "incorporated", "locality", "region", "postcode", "sicCodes", "firstName", "lastName"];

async function main(): Promise<void> {
  const { opts, flags } = parseArgs(process.argv.slice(2));
  if (!companiesHouseConfigured()) {
    console.error("ERROR: COMPANIES_HOUSE_API_KEY not set. Create a REST key at developer.company-information.service.gov.uk and add it to .env.local.");
    process.exit(1);
  }
  const sicCodes = opts.sic ? [opts.sic] : ROOFING_SIC_CODES;
  const max = Number(opts.max ?? 100000);
  const withOfficers = flags.has("with-officers");
  const outPath = path.resolve(process.cwd(), opts.out ?? "tmp/uk-roofers.csv");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`Companies House pull — SICs ${sicCodes.join(",")}, max ${max}, officers: ${withOfficers}`);
  fs.writeFileSync(outPath, HEADER.join(",") + "\n", "utf8");

  let total = 0;
  await searchRoofingCompanies({
    sicCodes, max,
    onPage: async (rows: CHCompany[]) => {
      // Optionally enrich each with the director name (one extra API call/company).
      const lines: string[] = [];
      for (const c of rows) {
        let firstName: string | null = null, lastName: string | null = null;
        if (withOfficers) {
          const d = await getPrimaryDirector(c.companyNumber);
          firstName = d?.firstName ?? null; lastName = d?.lastName ?? null;
        }
        lines.push([
          csvField(c.companyNumber), csvField(c.companyName), csvField(c.status), csvField(c.incorporated),
          csvField(c.locality), csvField(c.region), csvField(c.postcode), csvField(c.sicCodes.join(" ")),
          csvField(firstName), csvField(lastName),
        ].join(","));
      }
      fs.appendFileSync(outPath, lines.join("\n") + "\n", "utf8");
      total += rows.length;
      console.log(`  …${total} companies written`);
    },
  });

  console.log(`\n✅ ${total} UK roofing companies written to ${outPath}`);
  console.log(withOfficers
    ? `Next: npm run leads:build -- --csv ${opts.out ?? "tmp/uk-roofers.csv"}   (domain → owner email → verify → qualify → personalise → store)`
    : `Tip: re-run with --with-officers to also capture owner names (needed for best email pattern-matching), then leads:build --csv.`);
}

main().catch((err) => { console.error("leads:ch FAILED:", err instanceof Error ? err.message : err); process.exit(1); });
