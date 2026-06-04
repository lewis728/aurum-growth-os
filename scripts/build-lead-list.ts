/**
 * scripts/build-lead-list.ts  (npm run leads:build)
 *
 * Builds the lead list end to end and STORES it, ready to drip through the sequencer:
 *   SOURCE (Google Maps via Outscraper — name/website/phone/reviews)
 *   → FIND the owner email (Findymail/Hunter, role-guarded)
 *   → create OutreachProspect
 *   → processProspect: QUALIFY (ICP) → ENRICH (ads/reviews) → GRADE A/B/C/D
 *      → brutally VERIFY (MillionVerifier) → write a HYPER-PERSONALISED hook
 *      → 4-email sequence → status "generated" (emailable, A/B only).
 *
 * The final stored list: OutreachProspect rows. status "generated" = verified +
 * personalised + ready for `dispatchProspects` (the sequencer). "review"/"rejected"
 * are parked with the reason. Idempotent (dedupes by domain). Bounded concurrency.
 *
 * Run examples:
 *   npm run leads:build -- --areas "Dorset,Devon,Hampshire" --limit 100
 *   npm run leads:build -- --query "roofers in Leeds" --limit 50
 *   npm run leads:build                      # whole UK (built-in area list)
 *   npm run leads:build -- --estimate        # preview the queries + config, source nothing
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import * as fs from "fs";
import { prisma } from "../src/lib/prisma";
import { sourceBusinesses, sourcingConfigured, type SourcedBusiness } from "../src/lib/leads/sourcing";
import { findOwnerEmail, emailFinderConfigured } from "../src/lib/leads/emailFinder";
import { guessOwnerEmail } from "../src/lib/leads/patternGuess";
import { isRoleEmail } from "../src/lib/outreach/decisionMaker";
import { sanitizeCompanyName } from "../src/lib/outreach/nameSanitizer";
import { domainOf } from "../src/lib/outreach/websiteText";
import { normaliseNiche } from "../src/lib/outreach/niche";
import { processProspect } from "../src/lib/outreach/persist";
import { mapPool } from "../src/lib/utils/concurrency";

// Broad UK coverage for "the whole market" when no --areas/--query is given.
const UK_AREAS = [
  "London", "Birmingham", "Manchester", "Leeds", "Liverpool", "Sheffield", "Bristol", "Newcastle",
  "Nottingham", "Leicester", "Coventry", "Bradford", "Hull", "Stoke-on-Trent", "Wolverhampton",
  "Plymouth", "Derby", "Southampton", "Portsmouth", "Brighton", "Bournemouth", "Poole", "Reading",
  "Milton Keynes", "Luton", "Northampton", "Norwich", "Ipswich", "Cambridge", "Oxford", "Exeter",
  "Gloucester", "Cheltenham", "Swindon", "Peterborough", "York", "Preston", "Blackpool", "Bolton",
  "Sunderland", "Middlesbrough", "Doncaster", "Wakefield", "Huddersfield", "Cardiff", "Swansea",
  "Newport", "Edinburgh", "Glasgow", "Aberdeen", "Dundee", "Belfast",
  "Kent", "Essex", "Surrey", "Hampshire", "Devon", "Dorset", "Cornwall", "Somerset", "Lancashire",
  "Cheshire", "Staffordshire", "Warwickshire", "Lincolnshire", "Norfolk", "Suffolk", "Hertfordshire",
];

function parseArgs(argv: string[]): { opts: Record<string, string>; flags: Set<string> } {
  const opts: Record<string, string> = {}; const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const n = argv[i + 1]; if (n && !n.startsWith("--")) { opts[k] = n; i++; } else flags.add(k); }
  }
  return { opts, flags };
}

async function resolveTenant(arg?: string): Promise<string> {
  if (arg) return arg;
  if (process.env.OUTREACH_DEFAULT_TENANT) return process.env.OUTREACH_DEFAULT_TENANT;
  if (process.env.ONBOARD_TENANT) return process.env.ONBOARD_TENANT;
  const bp = await prisma.campaignBlueprint.findFirst({ orderBy: { createdAt: "desc" }, select: { tenantId: true } }).catch(() => null);
  if (bp?.tenantId) return bp.tenantId;
  throw new Error("No tenant — set OUTREACH_DEFAULT_TENANT or pass --tenant.");
}

interface Tally { sourced: number; created: number; generated: number; review: number; rejected: number; noWebsite: number; noEmail: number; duplicate: number; errored: number }
const zero = (): Tally => ({ sourced: 0, created: 0, generated: 0, review: 0, rejected: 0, noWebsite: 0, noEmail: 0, duplicate: 0, errored: 0 });

type IngestResult = "noWebsite" | "duplicate" | "noEmail" | "errored" | "generated" | "review" | "rejected";

function tallyAdd(total: Tally, k: IngestResult): void {
  if (k === "noWebsite") total.noWebsite++;
  else if (k === "duplicate") total.duplicate++;
  else if (k === "noEmail") { total.noEmail++; total.created++; }
  else if (k === "errored") total.errored++;
  else { total.created++; total[k]++; }
}

/**
 * One sourced business → verified, qualified, personalised, stored lead. Shared by
 * the Maps-query mode and the Companies House --csv mode. owner = the director name
 * (from Companies House) used for pattern-guessing the email when no finder hits.
 */
async function ingestOne(
  b: SourcedBusiness, tenantId: string, niche: string, seen: Set<string>,
  owner?: { firstName?: string | null; lastName?: string | null },
): Promise<IngestResult> {
  const domain = domainOf(b.website ?? "");
  if (!domain) return "noWebsite";
  if (seen.has(domain)) return "duplicate";
  seen.add(domain);
  const dup = await prisma.outreachProspect.findFirst({ where: { tenantId, websiteDomain: domain }, select: { id: true } }).catch(() => null);
  if (dup) return "duplicate";

  // Email waterfall: on-site → finder (by domain) → pattern-guess (owner name + domain).
  let email = b.email && !isRoleEmail(b.email) ? b.email : null;
  if (!email && emailFinderConfigured()) {
    const found = await findOwnerEmail(domain);
    if (found && !isRoleEmail(found.email)) email = found.email;
  }
  if (!email && owner && (owner.firstName || owner.lastName)) {
    const g = await guessOwnerEmail({ firstName: owner.firstName, lastName: owner.lastName, domain });
    if (g) email = g.email;
  }

  const base = {
    tenantId, firstName: owner?.firstName ?? null, lastName: owner?.lastName ?? null,
    companyName: b.name, cleanCompanyName: sanitizeCompanyName(b.name) || null,
    website: b.website ?? "", websiteDomain: domain, location: b.city ?? null, country: "GB",
    vertical: niche, source: "scrape", reviewCount: b.reviewCount ?? null, reviewRating: b.rating ?? null,
  };

  if (!email) {
    await prisma.outreachProspect.create({ data: { ...base, status: "review", qualifyReason: "No owner email found" } }).catch(() => {});
    return "noEmail";
  }
  const created = await prisma.outreachProspect.create({ data: { ...base, contactEmail: email, status: "pending" } }).catch(() => null);
  if (!created) return "errored";
  const res = await processProspect({ prospectId: created.id, tenantId, knownReviewCount: b.reviewCount ?? null, knownReviewRating: b.rating ?? null });
  if (res.status === "generated") return "generated";
  if (res.status === "review") return "review";
  if (res.status === "rejected") return "rejected";
  return "errored";
}

interface CsvRow { companyName: string; firstName: string | null; lastName: string | null; locality: string | null }

/** Minimal CSV reader for the Companies House export (quoted fields, header row). */
function readCompaniesHouseCsv(file: string): CsvRow[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const parse = (line: string): string[] => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out;
  };
  const header = parse(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const ci = { name: idx("companyName"), fn: idx("firstName"), ln: idx("lastName"), loc: idx("locality") };
  return lines.slice(1).map((l) => {
    const f = parse(l);
    return {
      companyName: (f[ci.name] ?? "").trim(),
      firstName: (f[ci.fn] ?? "").trim() || null,
      lastName: (f[ci.ln] ?? "").trim() || null,
      locality: (f[ci.loc] ?? "").trim() || null,
    };
  }).filter((r) => r.companyName);
}

async function main(): Promise<void> {
  const { opts, flags } = parseArgs(process.argv.slice(2));
  const niche = normaliseNiche(opts.niche ?? "roofing");
  const nicheLabel = niche === "home_improvement" ? "home improvement companies" : "roofers";
  const limit = Number(opts.limit ?? 100);
  const concurrency = Number(opts.concurrency ?? 3);

  const queries = opts.query
    ? [opts.query]
    : (opts.areas ? opts.areas.split(",").map((a) => a.trim()).filter(Boolean) : UK_AREAS).map((area) => `${nicheLabel} in ${area}, UK`);

  console.log(`Lead-list build — niche=${niche}, ${queries.length} queries, limit ${limit}/query, concurrency ${concurrency}`);
  console.log(`Sourcing configured: ${sourcingConfigured()} | Email finder configured: ${emailFinderConfigured()} | Verifier: ${Boolean(process.env.MILLIONVERIFIER_API_KEY)}`);

  if (flags.has("estimate")) {
    console.log("\n--estimate — queries that WOULD run:");
    queries.slice(0, 20).forEach((q) => console.log("  •", q));
    if (queries.length > 20) console.log(`  … +${queries.length - 20} more`);
    if (!sourcingConfigured()) console.log("\n⚠️  OUTSCRAPER_API_KEY not set — sourcing would return nothing.");
    if (!emailFinderConfigured()) console.log("⚠️  No email finder key (FINDYMAIL_API_KEY/HUNTER_API_KEY) — owner emails won't be found.");
    await prisma.$disconnect(); return;
  }
  if (!sourcingConfigured()) {
    console.error("\nERROR: sourcing not configured. Set OUTSCRAPER_API_KEY (+ LEAD_SOURCE_PROVIDER) and re-run. See .env.example.");
    await prisma.$disconnect(); process.exit(1);
  }

  const tenantId = await resolveTenant(opts.tenant);
  const total = zero();
  const seen = new Set<string>();

  // ── Companies House CSV mode: enrich the free register into emailable leads ──
  if (opts.csv) {
    const rows = readCompaniesHouseCsv(path.resolve(process.cwd(), opts.csv));
    console.log(`CSV mode — ${rows.length} companies from ${opts.csv}`);
    const settled = await mapPool(rows, concurrency, async (r) => {
      total.sourced++;
      const hits = await sourceBusinesses(`${r.companyName} ${r.locality ?? ""}, UK`.trim(), 1);
      const b: SourcedBusiness = hits[0] ?? { name: r.companyName, website: null, phone: null, city: r.locality, address: null, rating: null, reviewCount: null, email: null };
      return ingestOne(b, tenantId, niche, seen, { firstName: r.firstName, lastName: r.lastName });
    });
    for (const s of settled) { if (s.status !== "fulfilled") { total.errored++; continue; } tallyAdd(total, s.value); }
    console.log("\n══════════ FINAL ══════════"); console.log(JSON.stringify(total, null, 2));
    console.log(`\n${total.generated} verified + personalised leads READY in the database (status "generated").`);
    await prisma.$disconnect(); return;
  }

  for (const query of queries) {
    const businesses = await sourceBusinesses(query, limit);
    total.sourced += businesses.length;
    console.log(`\n[${query}] sourced ${businesses.length}`);

    const settled = await mapPool(businesses, concurrency, (b) => ingestOne(b, tenantId, niche, seen));
    for (const s of settled) { if (s.status !== "fulfilled") { total.errored++; continue; } tallyAdd(total, s.value); }
    console.log(`  running totals — created ${total.created}, generated(ready) ${total.generated}, review ${total.review}, rejected ${total.rejected}, no-email ${total.noEmail}, dupes ${total.duplicate}`);
  }

  console.log("\n══════════ FINAL ══════════");
  console.log(JSON.stringify(total, null, 2));
  console.log(`\n${total.generated} verified + personalised leads are READY in the database (status "generated").`);
  console.log(`Drip them through the sequencer with the autopilot cron / dispatchProspects.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("leads:build FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
