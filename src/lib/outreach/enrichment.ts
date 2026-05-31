/**
 * src/lib/outreach/enrichment.ts
 * SERVER-SIDE ONLY. The lead-quality engine — runs BEFORE the qualifier so the
 * model judges off real signals, not just scraped prose, and so junk is graded
 * out before it ever costs a hook or a send.
 *
 * Signals gathered (all graceful, never throw):
 *   - isRunningAds  : Meta Ad Library hit for the clinic name → the strongest
 *                     buy-signal for this ICP (they already spend on ads).
 *   - hasPhone      : a phone number is present in the site text (callable lead).
 *   - hasBooking    : a booking system is referenced (Calendly/Jane/Acuity/etc).
 *   - reviewCount/Rating: parsed from the site text when present (demand proof).
 *
 * Then gradeLead() turns those + the qualifier's fit_score into an A/B/C/D grade.
 * Only A/B are emailed; C is parked (re-check later); D is rejected.
 */

import { searchAdLibrary } from "@/lib/services/metaAdLibrary";

export interface EnrichmentSignals {
  isRunningAds: boolean | null; // null when the Ad Library couldn't be queried
  hasPhone:     boolean;
  hasBooking:   boolean;
  reviewCount:  number | null;
  reviewRating: number | null;
}

const BOOKING_HINTS = [
  "calendly", "acuity", "janeapp", "jane app", "fresha", "treatwell", "setmore",
  "book now", "book online", "book a consultation", "booking", "schedule",
];

const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/; // loose international/UK phone shape
const REVIEW_COUNT_RE = /([\d,]{1,6})\s*(?:google\s*)?reviews?/i;
const RATING_RE = /\b([0-5](?:\.\d)?)\s*(?:\/\s*5|stars?|out of 5)/i;

/**
 * Gathers enrichment signals for a prospect. NEVER THROWS — returns nulls/false
 * for anything it couldn't determine.
 */
export async function enrichProspect(opts: {
  companyName: string;
  websiteText: string;
}): Promise<EnrichmentSignals> {
  const text = opts.websiteText ?? "";
  const lower = text.toLowerCase();

  const hasPhone = PHONE_RE.test(text);
  const hasBooking = BOOKING_HINTS.some((h) => lower.includes(h));

  let reviewCount: number | null = null;
  const rc = text.match(REVIEW_COUNT_RE);
  if (rc) { const n = parseInt(rc[1].replace(/,/g, ""), 10); if (Number.isFinite(n)) reviewCount = n; }

  let reviewRating: number | null = null;
  const rr = text.match(RATING_RE);
  if (rr) { const n = parseFloat(rr[1]); if (Number.isFinite(n) && n <= 5) reviewRating = n; }

  // Meta Ad Library — the buy-signal. Graceful: returns null if the token is unset
  // (we can't claim "not running ads" when we simply couldn't look).
  let isRunningAds: boolean | null = null;
  try {
    const rows = await searchAdLibrary(opts.companyName, { country: "GB", limit: 5 });
    if (rows.length > 0) isRunningAds = true;
    else if (process.env.META_ADLIBRARY_TOKEN) isRunningAds = false; // looked, found none
    // else stays null: no token, didn't really look
  } catch {
    isRunningAds = null;
  }

  return { isRunningAds, hasPhone, hasBooking, reviewCount, reviewRating };
}

export type LeadGrade = "A" | "B" | "C" | "D";

/**
 * Grades a lead from the qualifier's fit_score + enrichment signals.
 *   A — strong fit AND a real buy/contactability signal → email first.
 *   B — solid fit → email.
 *   C — borderline / thin evidence → park, re-check later, don't burn a send.
 *   D — qualifier rejected or clearly unsuitable → never email.
 * Pure function; deterministic.
 */
export function gradeLead(opts: {
  accepted: boolean;
  fitScore: number;
  signals: EnrichmentSignals;
}): LeadGrade {
  const { accepted, fitScore, signals } = opts;
  if (!accepted || fitScore < 50) return "D";

  // A contactable lead that's already advertising is the dream for this ICP.
  const strongBuySignal = signals.isRunningAds === true;
  const contactable = signals.hasPhone || signals.hasBooking;
  const demandProof = (signals.reviewCount ?? 0) >= 20;

  if (fitScore >= 80 && contactable && (strongBuySignal || demandProof)) return "A";
  if (fitScore >= 70 && contactable) return "B";
  if (fitScore >= 75) return "B"; // high fit but couldn't confirm contactability
  return "C";
}

/** Grades that are allowed into the email machine. */
export const EMAILABLE_GRADES: LeadGrade[] = ["A", "B"];
