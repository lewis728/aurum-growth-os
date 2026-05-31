/**
 * src/lib/outreach/hookGenerator.ts
 * SERVER-SIDE ONLY. Module 3 — adversarial Writer → Critic hook engine.
 *
 * PASS 1 (Writer): writes a punchy, ultra-casual opening line (<20 words) that
 *   observes a specific real-world gap (great reviews but no Meta ads, a named
 *   treatment, the town, a website detail).
 * PASS 2 (Critic): a strict editor rejects AI hallmarks ("I noticed",
 *   "impressive", "congratulations", "delve", "synergy", …) or anything formal,
 *   and forces a rewrite. We loop up to MAX_PASSES until it passes the ban-list.
 *
 * Returns the final `custom_hook` string. NEVER THROWS — falls back to a safe,
 * specific-ish hook if the model is unavailable, so the sequence can still build.
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_PASSES = 3;
const MAX_WORDS = 20;

// Phrases that scream "an AI wrote this". The critic + a local guard both check.
const AI_HALLMARKS = [
  "i noticed", "i came across", "i stumbled", "impressive", "congratulations",
  "congrats", "delve", "synergy", "i hope this email finds you", "reaching out",
  "i wanted to reach", "elevate", "in today's", "fast-paced", "leverage",
  "game-changer", "unlock", "tailored", "cutting-edge", "i'm impressed",
];

export interface HookInput {
  businessName: string;
  cleanName?:   string;
  location?:    string;
  vertical?:    string;
  treatments?:  string;
  website?:     string;
  websiteText?: string;
  hasAds?:      boolean;
  reviewCount?: number;
  reviewRating?: number;
}

// Maps a vertical key to a natural noun for the hook prompt. Unknown verticals
// fall back to a safe generic, so the engine works for ANY ICP, not just clinics.
const VERTICAL_NOUNS: Record<string, string> = {
  aesthetics:      "aesthetics clinic",
  dental:          "dental practice",
  cosmetic_surgery: "cosmetic surgery clinic",
  hair_transplant: "hair transplant clinic",
  roofing:         "roofing company",
  hvac:            "HVAC company",
  real_estate:    "estate agency",
  legal:           "law firm",
  personal_injury: "personal injury firm",
  financial_services: "financial services firm",
};

function verticalNoun(vertical?: string): string {
  const key = (vertical ?? "").toLowerCase().trim();
  return VERTICAL_NOUNS[key] ?? "local business";
}

export interface HookResult {
  custom_hook: string;
  passes:      number;   // how many writer attempts it took
  approved:    boolean;  // true if the critic/guard cleared it
  fallback?:   boolean;  // true if produced without the model
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function hasHallmark(s: string): boolean {
  const lower = s.toLowerCase();
  return AI_HALLMARKS.some((h) => lower.includes(h));
}

function clean(s: string): string {
  return s.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s{2,}/g, " ").trim();
}

function contextBlock(input: HookInput): string {
  const name = input.cleanName || input.businessName;
  const lines = [`Business: ${name}`];
  if (input.location) lines.push(`Location: ${input.location}`);
  if (input.treatments) lines.push(`Treatments/services: ${input.treatments}`);
  if (typeof input.reviewCount === "number") {
    lines.push(`Google reviews: ${input.reviewCount}${typeof input.reviewRating === "number" ? ` at ${input.reviewRating} stars` : ""}`);
  }
  if (typeof input.hasAds === "boolean") lines.push(`Currently running Facebook ads: ${input.hasAds ? "yes" : "no"}`);
  if (input.websiteText) lines.push(`Website hero/snippet:\n${input.websiteText.slice(0, 1200)}`);
  return lines.join("\n");
}

async function writeHook(input: HookInput, critique?: string): Promise<string> {
  const name = input.cleanName || input.businessName;
  const system =
    `You write cold-email opening lines that sound like a real human texting a mate — ` +
    `casual, specific, lowercase-friendly, never salesy. You observe ONE concrete, real ` +
    `detail about the business. Output ONLY the single sentence, no quotes, no preamble.`;

  // Describe the business by its vertical, not a hardcoded "aesthetics clinic",
  // so the same engine writes natural hooks for any ICP (clinic, roofer, dentist…).
  const businessNoun = verticalNoun(input.vertical);
  const user = [
    `Write a single personalised opening line for a cold email to ${name}, ` +
      `a${input.location ? ` ${input.location}` : ""} ${businessNoun}.`,
    ``,
    contextBlock(input),
    ``,
    `Rules:`,
    `- Maximum ${MAX_WORDS} words. One sentence.`,
    `- Reference something specific and REAL about THEM (a named treatment, the town, their reviews, a line from their site). Specific beats clever.`,
    `- Good angles for this kind of business, in order: a standout treatment or their reputation/reviews; the fact they've clearly got capacity to book more; or the classic gap — enquiries that come in after hours and don't get called back fast enough.`,
    `- Do NOT assume they aren't advertising — most already run ads that just don't deliver consistently. If you mention ads at all, frame it as "running ads but the bookings aren't landing", never "you're not running ads".`,
    `- Talk outcomes (more booked consultations / a fuller calendar), never tech or "AI".`,
    `- Ultra-casual and warm, like a text to a mate. Lowercase is fine.`,
    `- BANNED phrases (never use): "I noticed", "I came across", "impressive", "congratulations", "delve", "synergy", "reaching out", "AI-powered". Anything formal is rejected.`,
    critique ? `\nYour previous attempt was rejected by the editor: ${critique}\nWrite a better one that fixes this.` : ``,
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model:       "gpt-4o",
    temperature: 0.8,
    max_tokens:  80,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });
  return clean(completion.choices[0]?.message?.content ?? "");
}

interface Critique { approved: boolean; reason: string; }

async function critiqueHook(hook: string): Promise<Critique> {
  const system =
    `You are a ruthless cold-email editor. You reject any line that sounds AI-written, ` +
    `formal, generic, or salesy. Output STRICT JSON only.`;
  const user = [
    `Line: "${hook}"`,
    ``,
    `Reject if it: contains AI hallmarks ("I noticed", "impressive", "congratulations", "delve", "synergy", "reaching out", etc.), sounds formal/corporate, is generic (could be sent to any business), exceeds ${MAX_WORDS} words, or isn't a single natural sentence.`,
    `Approve only if it sounds like a real human who genuinely looked at THIS business.`,
    ``,
    `Return JSON exactly: {"approved": boolean, "reason": string}.`,
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model:           "gpt-4o",
    temperature:     0.2,
    max_tokens:      150,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  // Treat a malformed critic response as a soft rejection, never a throw — the
  // writer loop should keep going, not abort the whole hook.
  try {
    const parsed = JSON.parse(raw) as { approved?: unknown; reason?: unknown };
    return {
      approved: parsed.approved === true,
      reason:   typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return { approved: false, reason: "editor response unreadable — rewriting" };
  }
}

/** Deterministic, specific-enough fallback when the model is unavailable. */
function fallbackHook(input: HookInput): string {
  const name = input.cleanName || input.businessName;
  const place = input.location ? ` in ${input.location}` : "";
  if ((input.reviewCount ?? 0) > 0) {
    return `${input.reviewCount} reviews for ${name}${place} and i bet half your enquiries never get called back in time.`;
  }
  return `been looking at ${name}${place} and reckon you could be booking a lot more consults than you are.`;
}

/**
 * Generates the final custom hook via Writer→Critic loop. NEVER THROWS.
 */
export async function generateHook(input: HookInput): Promise<HookResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { custom_hook: fallbackHook(input), passes: 0, approved: false, fallback: true };
  }

  let lastHook = "";
  let critique = "";
  try {
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      const hook = await writeHook(input, critique || undefined);
      lastHook = hook || lastHook;
      if (!hook) continue;

      // Local guard first (cheap), then the LLM critic.
      if (hasHallmark(hook) || wordCount(hook) > MAX_WORDS) {
        critique = hasHallmark(hook) ? "contains a banned AI phrase" : `too long (>${MAX_WORDS} words)`;
        continue;
      }
      // On the final pass, skip the critic call — there's no further rewrite to
      // gain from its verdict, so spending the 6th GPT call is pure waste. The
      // hook has already cleared the local ban-list guard above, so accept it.
      if (pass === MAX_PASSES) {
        return { custom_hook: hook, passes: pass, approved: false };
      }
      const verdict = await critiqueHook(hook);
      if (verdict.approved) {
        return { custom_hook: hook, passes: pass, approved: true };
      }
      critique = verdict.reason || "rejected by editor";
    }
    // Exhausted passes — return the best we have if it at least clears the local guard.
    if (lastHook && !hasHallmark(lastHook) && wordCount(lastHook) <= MAX_WORDS) {
      return { custom_hook: lastHook, passes: MAX_PASSES, approved: false };
    }
    return { custom_hook: fallbackHook(input), passes: MAX_PASSES, approved: false, fallback: true };
  } catch (err) {
    console.error("[hookGenerator] failed:", err instanceof Error ? err.message : err);
    return { custom_hook: lastHook || fallbackHook(input), passes: 0, approved: false, fallback: !lastHook };
  }
}
