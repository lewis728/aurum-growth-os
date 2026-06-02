/**
 * src/lib/outreach/decisionMaker.ts
 * SERVER-SIDE-safe (pure). The "straight to the boss, never a generic inbox" guard.
 *
 * Two jobs:
 *   1. isRoleEmail()      — reject generic/shared inboxes (info@, sales@, admin@…)
 *                           so we ONLY ever email a real person, never a department.
 *   2. looksLikeOwner()   — score a job title against the owner/decision-maker ICP
 *                           (owner, founder, director, principal, practice manager…)
 *
 * Clay does the waterfall FIND of the decision-maker; this is the hard gate that
 * guarantees what actually reaches the send queue is a personal, owner-level mailbox.
 * Pure + deterministic; no I/O. NEVER THROWS.
 */

// Generic/shared local-parts that are never a single decision-maker. Matched on the
// part before the "@" (exact or as a prefix like "info."/"sales-uk").
const ROLE_LOCALPARTS = new Set([
  "info", "sales", "admin", "hello", "hi", "contact", "enquiries", "enquiry",
  "inquiries", "inquiry", "office", "team", "support", "help", "mail", "email",
  "marketing", "reception", "frontdesk", "front", "bookings", "booking", "appointments",
  "accounts", "accounting", "billing", "finance", "hr", "jobs", "careers", "recruitment",
  "noreply", "no-reply", "donotreply", "newsletter", "press", "media", "general",
  "clinic", "practice", "studio", "shop", "service", "services", "customerservice",
  "post", "web", "webmaster", "privacy", "legal", "dpo", "gdpr",
]);

/** Normalises an email to lowercase, trimmed. Returns "" if obviously invalid. */
function normalise(email: string | null | undefined): string {
  const e = (email ?? "").trim().toLowerCase();
  return e.includes("@") ? e : "";
}

/**
 * True if the address is a generic/shared/role inbox rather than a person.
 * Conservative: only flags clear role local-parts; a real name (lewis@, j.smith@)
 * passes. Treats "info.uk@", "sales-team@", "no_reply@" as role too.
 */
export function isRoleEmail(email: string | null | undefined): boolean {
  const e = normalise(email);
  if (!e) return false; // invalid handled by the verifier/regex, not here
  const local = e.split("@")[0]?.replace(/\+.*$/, "") ?? ""; // strip +tag
  if (!local) return true;
  if (ROLE_LOCALPARTS.has(local)) return true;
  // Role prefix with a separator: "info.uk", "sales-2024", "bookings_london".
  const head = local.split(/[._-]/)[0] ?? "";
  if (ROLE_LOCALPARTS.has(head)) return true;
  return false;
}

// Titles that indicate the owner / final decision-maker for our SMB ICP.
const OWNER_TITLE_RE =
  /\b(owner|founder|co[- ]?founder|proprietor|principal|director|managing director|md|ceo|president|partner|principal dentist|lead (clinician|nurse|practitioner)|clinic owner|practice (owner|principal|manager)|practice owner|sole trader)\b/i;

// Titles that are clearly NOT the decision-maker (gatekeepers / junior staff).
const NON_OWNER_TITLE_RE =
  /\b(receptionist|front desk|administrator|admin assistant|secretary|coordinator|assistant|apprentice|trainee|intern|customer service|sales rep|representative|technician|fitter|installer|nurse(?! (owner|director))|therapist(?! (owner|director)))\b/i;

/**
 * Heuristic: does this job title look like the owner/decision-maker?
 * Returns true when the title clearly matches an owner-level role, false when it's
 * a clear gatekeeper, and `null` when there's no usable title (caller decides).
 */
export function looksLikeOwner(title: string | null | undefined): boolean | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  if (NON_OWNER_TITLE_RE.test(t)) return false;
  if (OWNER_TITLE_RE.test(t)) return true;
  return null; // an unrecognised but present title — don't hard-block on it
}

/**
 * Extracts a city from a free-text location ("Leeds, UK" → "Leeds",
 * "Austin, TX" → "Austin", "Manchester" → "Manchester"). Used for the
 * {{city}} merge tag. Returns "" when nothing usable. Pure.
 */
export function extractCity(location: string | null | undefined): string {
  const s = (location ?? "").trim();
  if (!s) return "";
  // First comma-separated token, stripped of obvious country/region noise.
  const first = s.split(",")[0]?.trim() ?? "";
  const cleaned = first.replace(/\b(uk|united kingdom|england|scotland|wales|usa|us|united states)\b/gi, "").trim();
  return cleaned || first;
}
