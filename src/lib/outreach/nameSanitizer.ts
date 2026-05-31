/**
 * src/lib/outreach/nameSanitizer.ts
 * Cleans a raw company_name into something that looks like a human typed it
 * (Module 1, Gemini spec). Strips legal/structural suffixes, fixes erratic
 * capitalisation, collapses whitespace/punctuation. Pure, deterministic, no I/O.
 */

// Structural/legal suffixes to strip (longest-first so "and Sons" beats "Sons").
const SUFFIXES = [
  "incorporated", "corporation", "limited liability company",
  "and sons", "& sons", "and co", "& co",
  "llc", "l.l.c", "inc", "inc.", "corp", "corp.", "co", "co.",
  "ltd", "ltd.", "limited", "plc", "llp", "gmbh", "ag", "bv", "pty",
  "pllc", "pc", "p.c", "group", "holdings", "enterprises",
];

const ALL_CAPS_KEEP = new Set(["UK", "USA", "NYC", "LA", "MD", "PA", "DC", "HQ"]);

/** Title-cases a single word, preserving known acronyms and hyphen/apostrophe parts. */
function titleWord(word: string): string {
  if (!word) return word;
  if (ALL_CAPS_KEEP.has(word.toUpperCase())) return word.toUpperCase();
  // Preserve intentional internal caps (e.g. "McAllister", "L'Oreal") only when the
  // word is mixed-case already; otherwise normalise ALL-CAPS / all-lower → Title.
  const isAllCaps = word === word.toUpperCase();
  const isAllLower = word === word.toLowerCase();
  if (!isAllCaps && !isAllLower) return word; // already mixed — leave it
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Title-cases a phrase, handling hyphenated and apostrophe'd parts. */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) =>
      w
        .split("-")
        .map((part) => part.split("'").map(titleWord).join("'"))
        .join("-"),
    )
    .join(" ");
}

/**
 * Sanitises a company name. Returns a clean, human-looking string. Never throws;
 * returns "" for empty input.
 */
export function sanitizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (!s) return "";

  // Drop anything in trailing brackets/parens, e.g. "Acme (Holdings)".
  s = s.replace(/\s*[([{][^)\]}]*[)\]}]\s*$/g, " ").trim();

  // Remove a trailing comma-separated suffix list, e.g. "Acme, LLC" / "Acme Ltd".
  // Repeat so "Acme Holdings Ltd" → "Acme".
  let changed = true;
  while (changed) {
    changed = false;
    const lower = s.toLowerCase();
    for (const suf of SUFFIXES) {
      // match suffix at end, optionally preceded by a comma and/or space
      const re = new RegExp(`[\\s,]+${suf.replace(/[.&]/g, (c) => "\\" + c)}\\.?\\s*$`, "i");
      if (re.test(s)) {
        s = s.replace(re, "").trim();
        changed = true;
        break;
      }
      // bare exact match (whole string is just the suffix-ish)
      if (lower === suf) { s = ""; changed = false; break; }
    }
  }

  // Collapse leftover punctuation/whitespace.
  s = s.replace(/[,\s]+$/g, "").replace(/\s{2,}/g, " ").trim();

  return titleCase(s);
}
