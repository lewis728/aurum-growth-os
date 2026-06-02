/**
 * src/lib/outreach/niche.ts
 * SERVER-SIDE-safe (pure data + helpers). One source of truth for the 6 launch
 * niches so every layer (template merge vars, hook engine, qualifier) speaks the
 * SAME niche-correct language — never "consultations" to a roofer or "clinic" to a
 * solar installer.
 *
 * Drives the email template merge tags:
 *   {{niche_service}}            → [Niche_Service]
 *   {{regional_booking_term}}    → [Regional_Booking_Term]  (niche + region aware)
 *   {{regional_revenue_term}}    → [Regional_Revenue_Term]  (region aware)
 * and the hook engine's outcome language. Pure; no I/O.
 */

import type { Region } from "@/lib/outreach/regional";

export interface NicheConfig {
  key:         string;  // canonical CampaignBlueprint/prospect vertical key
  noun:        string;  // natural noun for the hook ("HVAC company")
  service:     string;  // {{niche_service}} — what a local customer searches for
  bookingUK:   string;  // {{regional_booking_term}} UK register
  bookingUS:   string;  // {{regional_booking_term}} US register
  outcome:     string;  // hook outcome language ("booked jobs")
}

// The 6 launch niches. Same ICP shape (owner-operated local premium operator);
// only the trade-specific nouns differ. Keys match prospect.vertical.
export const NICHES: Record<string, NicheConfig> = {
  hvac: {
    key: "hvac", noun: "HVAC / heating company", service: "heating, cooling or boiler work",
    bookingUK: "job", bookingUS: "job", outcome: "booked jobs",
  },
  aesthetics: {
    key: "aesthetics", noun: "aesthetics clinic", service: "aesthetic treatments",
    bookingUK: "appointment", bookingUS: "appointment", outcome: "booked appointments",
  },
  cosmetic_dentistry: {
    key: "cosmetic_dentistry", noun: "dental practice", service: "cosmetic dental work (implants, veneers, Invisalign)",
    bookingUK: "consultation", bookingUS: "consultation", outcome: "booked consultations",
  },
  roofing: {
    key: "roofing", noun: "roofing company", service: "roof repairs or replacement",
    bookingUK: "job", bookingUS: "job", outcome: "booked jobs",
  },
  solar: {
    key: "solar", noun: "solar company", service: "solar panel installation",
    bookingUK: "survey", bookingUS: "survey", outcome: "booked surveys",
  },
  home_improvement: {
    key: "home_improvement", noun: "home improvement company", service: "home improvement work (kitchens, bathrooms, windows)",
    bookingUK: "job", bookingUS: "job", outcome: "booked jobs",
  },
};

const DEFAULT_NICHE: NicheConfig = {
  key: "local_business", noun: "local business", service: "your services",
  bookingUK: "booking", bookingUS: "appointment", outcome: "booked appointments",
};

/** Normalises a free-form vertical string to a canonical niche key (or the raw key). */
export function normaliseNiche(vertical: string | null | undefined): string {
  const v = (vertical ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (NICHES[v]) return v;
  // Common aliases → canonical keys.
  if (/dent/.test(v)) return "cosmetic_dentistry";
  if (/aesthet|botox|filler|cosmetic_clinic|med_?spa|medspa/.test(v)) return "aesthetics";
  if (/roof/.test(v)) return "roofing";
  if (/solar|pv|renewable/.test(v)) return "solar";
  if (/hvac|heating|boiler|air_?con|cooling|plumb/.test(v)) return "hvac";
  if (/kitchen|bathroom|window|home_?improv|renovat|extension|fit_?out/.test(v)) return "home_improvement";
  return v || "local_business";
}

/** Returns the niche config for a vertical, falling back to a safe generic. */
export function nicheConfig(vertical: string | null | undefined): NicheConfig {
  return NICHES[normaliseNiche(vertical)] ?? DEFAULT_NICHE;
}

/** The [Regional_Booking_Term] for a niche + region (US/UK/INTL). */
export function bookingTerm(vertical: string | null | undefined, region: Region): string {
  const c = nicheConfig(vertical);
  return region === "US" ? c.bookingUS : c.bookingUK;
}

/** The [Regional_Revenue_Term] for a region (kept simple and on-brand worldwide). */
export function revenueTerm(region: Region): string {
  return region === "US" ? "revenue" : "revenue";
}

/** Is this one of the 6 supported launch niches (vs the generic fallback)? */
export function isSupportedNiche(vertical: string | null | undefined): boolean {
  return Boolean(NICHES[normaliseNiche(vertical)]);
}
