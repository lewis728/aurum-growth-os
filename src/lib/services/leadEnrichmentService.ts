/**
 * src/lib/services/leadEnrichmentService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Lead fingerprinting (Sprint 10D). In the seconds between form submission and
 * Sophie's first call, enrich the lead and decide a tier so the call can be
 * personalised — premium leads get an exclusivity frame and NEVER hear a discount.
 *
 * Signals computed locally and instantly (no external dependency):
 *   - corporate vs free email domain (business-owner signal)
 *   - UK postcode presence in the form data (affordability proxy hook)
 * External enrichment (Hunter.io / Clearbit) is wrapped behind an API-key check
 * and NO-OPS gracefully when unconfigured — so this runs today and upgrades the
 * moment a key is added. NEVER THROWS.
 */

import { prisma } from "@/lib/prisma";

export type LeadTier = "standard" | "premium";

export interface EnrichmentData {
  tier:            LeadTier;
  signals:         string[];          // human-readable reasons for the tier
  corporateEmail:  boolean;
  emailDomain:     string | null;
  postcode:        string | null;
  externalEnriched: boolean;          // did a paid API actually run?
  externalData?:   Record<string, unknown>;
}

// Free / consumer mailbox providers — a corporate domain signals a business owner.
const FREE_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "live.co.uk", "icloud.com", "me.com", "aol.com", "btinternet.com",
  "sky.com", "msn.com", "ymail.com", "protonmail.com", "gmx.com",
]);

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

function emailDomainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

function findPostcode(formData: unknown): string | null {
  if (!formData || typeof formData !== "object") return null;
  for (const v of Object.values(formData as Record<string, unknown>)) {
    if (typeof v === "string") {
      const m = v.match(UK_POSTCODE_RE);
      if (m) return m[1].toUpperCase();
    }
  }
  return null;
}

/**
 * Optional external enrichment. Returns null (no-op) unless an API key is set.
 * Kept as a single seam so wiring Hunter.io/Clearbit later is a one-function change.
 * NEVER THROWS.
 */
async function externalEnrich(_email: string | null): Promise<Record<string, unknown> | null> {
  const key = process.env.HUNTER_API_KEY ?? process.env.CLEARBIT_API_KEY;
  if (!key || !_email) return null;
  // Intentionally not implemented against a live key here — when a key exists,
  // call the provider, map to { company, role, seniority, ... }, and return it.
  // Until then we no-op so behaviour is identical with or without the dependency.
  return null;
}

/**
 * Enriches a lead and persists tier + enrichmentData. Returns the tier.
 * Fast on the local-only path (no network). NEVER THROWS.
 */
export async function enrichLead(leadId: string, tenantId: string): Promise<LeadTier> {
  try {
    const lead = await prisma.lead.findFirst({
      where:  { id: leadId, tenantId },
      select: { email: true, formData: true },
    });
    if (!lead) return "standard";

    const emailDomain = emailDomainOf(lead.email);
    const corporateEmail = emailDomain !== null && !FREE_DOMAINS.has(emailDomain);
    const postcode = findPostcode(lead.formData);

    const external = await externalEnrich(lead.email);

    const signals: string[] = [];
    if (corporateEmail) signals.push(`Corporate email domain (${emailDomain}) — likely a business owner.`);
    if (postcode)       signals.push(`Postcode provided (${postcode}).`);
    if (external)       signals.push("External enrichment data available.");

    // Premium when there's a strong business-owner signal. (Postcode-based ONS
    // affordability scoring is a future upgrade behind the same seam.)
    const tier: LeadTier = corporateEmail ? "premium" : "standard";

    const enrichmentData: EnrichmentData = {
      tier, signals, corporateEmail, emailDomain, postcode,
      externalEnriched: external !== null,
      ...(external ? { externalData: external } : {}),
    };

    await prisma.lead.update({
      where: { id: leadId },
      data:  { leadTier: tier, enrichmentData: enrichmentData as unknown as object },
    }).catch((e: unknown) => console.error("[leadEnrichment] persist failed:", e instanceof Error ? e.message : e));

    return tier;
  } catch (err) {
    console.error(`[leadEnrichment] enrich failed for ${leadId}:`, err instanceof Error ? err.message : err);
    return "standard";
  }
}

/**
 * The call-frame for a tier — injected into Sophie's Retell dynamic variables.
 * Premium leads NEVER get discount language.
 */
export function callFrameForTier(tier: LeadTier): { lead_tier: LeadTier; tier_frame: string } {
  return tier === "premium"
    ? { lead_tier: "premium", tier_frame: "This is a high-value prospect. Use an exclusivity frame — a limited VIP consultation. Never mention discounts, vouchers, or price reductions." }
    : { lead_tier: "standard", tier_frame: "Use a helpful incentive frame — e.g. securing their consultation slot, and any standard offer applies." };
}
