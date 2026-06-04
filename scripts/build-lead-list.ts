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

import { prisma } from "../src/lib/prisma";
import { sourceBusinesses, sourcingConfigured } from "../src/lib/leads/sourcing";
import { findOwnerEmail, emailFinderConfigured } from "../src/lib/leads/emailFinder";
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

  for (const query of queries) {
    const businesses = await sourceBusinesses(query, limit);
    total.sourced += businesses.length;
    console.log(`\n[${query}] sourced ${businesses.length}`);

    const settled = await mapPool(businesses, concurrency, async (b) => {
      const domain = domainOf(b.website ?? "");
      if (!domain) { return "noWebsite" as const; }
      if (seen.has(domain)) { return "duplicate" as const; }
      seen.add(domain);

      const dup = await prisma.outreachProspect.findFirst({ where: { tenantId, websiteDomain: domain }, select: { id: true } }).catch(() => null);
      if (dup) return "duplicate" as const;

      // Real owner email: prefer a non-role on-site email, else find it.
      let email = b.email && !isRoleEmail(b.email) ? b.email : null;
      if (!email && emailFinderConfigured()) {
        const found = await findOwnerEmail(domain);
        if (found && !isRoleEmail(found.email)) email = found.email;
      }
      if (!email) {
        // Store the lead but parked — no owner email to send to.
        await prisma.outreachProspect.create({ data: {
          tenantId, companyName: b.name, cleanCompanyName: sanitizeCompanyName(b.name) || null,
          website: b.website ?? "", websiteDomain: domain, location: b.city ?? query, country: "GB",
          vertical: niche, source: "scrape", status: "review", qualifyReason: "No owner email found",
          reviewCount: b.reviewCount ?? null, reviewRating: b.rating ?? null,
        } }).catch(() => {});
        return "noEmail" as const;
      }

      const created = await prisma.outreachProspect.create({ data: {
        tenantId, firstName: null, companyName: b.name, cleanCompanyName: sanitizeCompanyName(b.name) || null,
        website: b.website ?? "", websiteDomain: domain, contactEmail: email, location: b.city ?? query, country: "GB",
        vertical: niche, source: "scrape", status: "pending",
        reviewCount: b.reviewCount ?? null, reviewRating: b.rating ?? null,
      } }).catch(() => null);
      if (!created) return "errored" as const;

      const res = await processProspect({
        prospectId: created.id, tenantId,
        knownReviewCount: b.reviewCount ?? null, knownReviewRating: b.rating ?? null,
      });
      if (res.status === "generated") return "generated" as const;
      if (res.status === "review") return "review" as const;
      if (res.status === "rejected") return "rejected" as const;
      return "errored" as const;
    });

    for (const s of settled) {
      if (s.status !== "fulfilled") { total.errored++; continue; }
      const k = s.value;
      if (k === "noWebsite") total.noWebsite++;
      else if (k === "duplicate") total.duplicate++;
      else if (k === "noEmail") { total.noEmail++; total.created++; }
      else if (k === "errored") total.errored++;
      else { total.created++; total[k]++; }
    }
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
