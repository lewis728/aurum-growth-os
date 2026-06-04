/**
 * src/lib/leads/patternGuess.ts
 * SERVER-SIDE ONLY. The near-free email step: from an owner NAME + DOMAIN, generate
 * the common business-email patterns, verify each (MillionVerifier), and return the
 * first that comes back genuinely deliverable. No finder subscription needed — this
 * is what turns the free Companies House names into emailable leads.
 *
 * STRICT: only returns an email the verifier confirms `valid`. If no verifier is
 * configured it returns null (won't send an unverified guess). NEVER THROWS.
 */

import { verifyEmail, verifierConfigured } from "@/lib/outreach/verify";
import { isRoleEmail } from "@/lib/outreach/decisionMaker";

function clean(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
}

/** The common UK SMB owner-email patterns, most-likely first. */
export function emailCandidates(firstName: string, lastName: string, domain: string): string[] {
  const f = clean(firstName), l = clean(lastName);
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!d.includes(".")) return [];
  const locals: string[] = [];
  if (f && l) locals.push(`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`, `${f[0]}.${l}`);
  else if (f) locals.push(`${f}`);
  else if (l) locals.push(`${l}`);
  return Array.from(new Set(locals)).map((lp) => `${lp}@${d}`).filter((e) => !isRoleEmail(e));
}

export interface GuessResult { email: string; source: "pattern" }

/**
 * Finds the owner's email by pattern + verification. Returns the first `valid`
 * candidate, or null. Caps verifier calls per company. NEVER THROWS.
 */
export async function guessOwnerEmail(opts: {
  firstName?: string | null;
  lastName?:  string | null;
  domain:     string;
  maxChecks?: number;
}): Promise<GuessResult | null> {
  const first = (opts.firstName ?? "").trim();
  const last = (opts.lastName ?? "").trim();
  if (!first && !last) return null;
  if (!verifierConfigured()) return null; // can't confirm a guess → don't send it

  const candidates = emailCandidates(first, last, opts.domain).slice(0, opts.maxChecks ?? 4);
  for (const email of candidates) {
    try {
      const v = await verifyEmail(email);
      if (v.sendable && v.status === "valid") return { email, source: "pattern" };
    } catch {
      /* graceful — try the next pattern */
    }
  }
  return null;
}
