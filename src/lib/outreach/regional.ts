/**
 * src/lib/outreach/regional.ts
 * SERVER-SIDE-safe (pure data + helpers). The global-outreach regional layer
 * (Part 5): NEVER send American copy to UK/AU or vice versa.
 *
 *   - detectRegion(country) → "US" | "UK" | "INTL"
 *   - resolveSpintax("{free|risk-free}") → deterministic single choice (seedable)
 *   - REGIONAL_LEXICON — word swaps (leads↔bookings, appointments↔jobs, …)
 *   - VERTICAL_OPENERS — the exact US + UK opening lines per vertical (from spec)
 *   - OFFER_BODY — the core 4-week-pilot offer, US + UK variants
 *
 * Pure + deterministic; no I/O. sequenceBuilder composes these per prospect.
 */

export type Region = "US" | "UK" | "INTL";

const US_COUNTRIES = new Set(["US", "USA", "UNITED STATES", "CA", "CAN", "CANADA"]);
const UK_COUNTRIES = new Set(["GB", "UK", "UNITED KINGDOM", "AU", "AUS", "AUSTRALIA", "NZ", "NEW ZEALAND", "IE", "IRELAND"]);

// Common location tokens → ISO-ish country code, for CSV/location-string parsing.
const COUNTRY_HINTS: { re: RegExp; code: string }[] = [
  { re: /\b(united states|u\.?s\.?a?|america)\b/i, code: "US" },
  { re: /\b(usa|us)\b/, code: "US" },
  { re: /\b(canada|\bcan\b)\b/i, code: "CA" },
  { re: /\b(united kingdom|england|scotland|wales|britain|\buk\b|\bgb\b)\b/i, code: "GB" },
  { re: /\b(australia|\baus\b|\bau\b)\b/i, code: "AU" },
  { re: /\b(new zealand|\bnz\b)\b/i, code: "NZ" },
  { re: /\b(ireland|\bie\b)\b/i, code: "IE" },
  { re: /\b(uae|united arab emirates|dubai|abu dhabi)\b/i, code: "AE" },
];

// US state codes/names → US (Apollo CSVs often only carry a city/state).
const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|MA|MD|MI|MN|MO|MS|NC|NJ|NV|NY|OH|OK|OR|PA|SC|TN|TX|UT|VA|WA|WI|texas|florida|california|new york)\b/i;

/**
 * Detects a country code from a free-text location/country field (e.g. "Leeds, UK",
 * "Austin, TX", "Dubai"). Returns an ISO-ish code; defaults to "GB" (launch market)
 * when nothing matches. Pure.
 */
export function detectCountry(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "GB";
  for (const h of COUNTRY_HINTS) if (h.re.test(s)) return h.code;
  if (US_STATES.test(s)) return "US";
  return "GB";
}

/** Maps a country code/name to the copy region. Defaults to UK (launch market). */
export function detectRegion(country: string | null | undefined): Region {
  const c = (country ?? "").trim().toUpperCase();
  if (!c) return "UK";
  if (US_COUNTRIES.has(c)) return "US";
  if (UK_COUNTRIES.has(c)) return "UK";
  // UAE / everything else → formal international register.
  return "INTL";
}

/**
 * Resolves spintax `{a|b|c}` to ONE option, deterministically by seed so the same
 * prospect always gets the same copy (and A/B variation comes from the seed, not
 * randomness — Math.random is avoided for reproducibility).
 */
export function resolveSpintax(text: string, seed = 0): string {
  let i = 0;
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, group: string) => {
    const opts = group.split("|");
    const idx = Math.abs((seed + i++) % opts.length);
    return opts[idx];
  });
}

// Region word-swaps. UK/AU/NZ share the British register; INTL stays neutral-formal.
export const REGIONAL_LEXICON: Record<Region, Record<string, string>> = {
  US: {
    bookings: "appointments", booking: "appointment", enquiries: "leads", enquiry: "lead",
    postcode: "zip code", revenue: "profits", mobile: "cell phone", diary: "calendar",
    "have a chat": "schedule a call", jobs: "jobs",
  },
  UK: {
    appointments: "bookings", appointment: "booking", leads: "enquiries", lead: "enquiry",
    "zip code": "postcode", profits: "revenue", "cell phone": "mobile", calendar: "diary",
    "schedule a call": "have a chat",
  },
  INTL: {}, // formal, results-focused, no slang — leave neutral wording as written
};

/** Applies the region lexicon to a string (whole-word, case-insensitive). */
export function applyLexicon(text: string, region: Region): string {
  const map = REGIONAL_LEXICON[region];
  let out = text;
  for (const [from, to] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "gi"), (m) => matchCase(m, to));
  }
  return out;
}

function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

// ── Per-vertical opening lines (verbatim from the master prompt) ────────────────
interface RegionalCopy { US: string; UK: string; }

export const VERTICAL_OPENERS: Record<string, RegionalCopy> = {
  aesthetics: {
    US: "I know how it feels when a lead fills out your form at 7pm and nobody can call them back until tomorrow morning. By then they've booked somewhere else.",
    UK: "I know how frustrating it is when an enquiry comes in at 7pm while you're with a client, and by the time anyone rings back the next morning they've already gone elsewhere.",
  },
  roofing: {
    US: "When someone sees your ad right after a storm and fills out your form, they're calling 3 other roofers at the same time. Whoever calls first gets the job.",
    UK: "When a homeowner spots a problem after bad weather and fills in your form, they're ringing round. Whoever gets back to them first gets the job.",
  },
  solar: {
    US: "Most solar leads go cold within 4 hours. Not because people change their mind — because nobody called them while they were still excited about their energy bill.",
    UK: "Most solar enquiries go cold within a few hours. Not because people lose interest — because nobody rang them while they were still thinking about their energy bills.",
  },
  hvac: {
    US: "When someone's AC breaks in August they call whoever picks up first. Not the best HVAC company in town — the fastest.",
    UK: "When someone's boiler packs in on a cold morning they ring whoever answers first. Not the best engineer in the area — the quickest to pick up.",
  },
  cosmetic_dentistry: {
    US: "Dental practices lose 60% of their website leads because the callback comes the next business day. By then the patient has booked with whoever called them the same evening.",
    UK: "Most dental practices lose over half their online enquiries because nobody rings back until the next working day. By then the patient has already sorted it elsewhere.",
  },
  home_improvement: {
    US: "Kitchen and bathroom leads have a 4-hour window. After that they've either booked someone else or talked themselves out of spending the money.",
    UK: "Home improvement enquiries go cold fast. Most people fill in a form on Saturday morning — if nobody's rung them by Saturday afternoon, they've moved on.",
  },
};

// ── Core offer body (verbatim from the master prompt), US + UK ──────────────────
export const OFFER_BODY: RegionalCopy = {
  US: "For the next 4 weeks, we want to fully manage your ads, call every single lead within 60 seconds, handle all the follow-up, send text reminders, and deliver booked appointments straight to your calendar. Completely free. No setup fees. No retainer. No contract. If we don't bring you real paying customers in 28 days, you owe nothing and keep everything we build. We're taking 100% of the risk. We can only do this for 2 businesses right now. Worth a quick 5-minute call to see the math?",
  UK: "For the next 4 weeks, we want to fully manage your ads, ring every single enquiry within 60 seconds, handle all the follow-up, send text reminders, and deliver confirmed bookings straight to your diary. Completely free. No setup fees. No retainer. No contract. If we don't bring you real paying customers in 28 days, you owe us nothing and keep everything we build. We're taking all the risk. We can only do this for 2 businesses at the moment. Worth a quick 5-minute chat to see how it works?",
};

/** The opener for a vertical+region; falls back to the aesthetics line if unknown. */
export function openerFor(vertical: string | undefined, region: Region): string {
  const v = VERTICAL_OPENERS[(vertical ?? "").toLowerCase()] ?? VERTICAL_OPENERS.aesthetics;
  const usOrUk = region === "US" ? v.US : v.UK; // INTL uses the (neutral) UK phrasing as base
  return usOrUk;
}

/** The offer body for a region. INTL gets the UK (formal-leaning) base. */
export function offerBodyFor(region: Region): string {
  return region === "US" ? OFFER_BODY.US : OFFER_BODY.UK;
}
