/**
 * src/lib/outreach/qualifier.ts
 * SERVER-SIDE ONLY. Module 2 — the two-stage hyper-qualifying gatekeeper.
 *
 * Routes the prospect's scraped website text to GPT-4o (temp 0.1 for low variance)
 * to judge ICP viability BEFORE we spend tokens personalising or ever send. Forces
 * strict JSON { qualified, reasons, fit_score }. A lead is accepted only when
 * qualified===true AND fit_score >= MIN_FIT_SCORE; otherwise it's rejected and the
 * caller stops the pipeline for that lead.
 *
 * (Gemini specced Claude 3.5 Sonnet; we use the codebase's existing GPT-4o to
 *  avoid adding an Anthropic dependency/key. Same JSON contract, temp 0.1.)
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MIN_FIT_SCORE = 75;

export interface QualifyInput {
  companyName: string;
  location?:   string;
  vertical?:   string;
  websiteText: string;
}

export interface QualifyResult {
  qualified:  boolean;
  reasons:    string;
  fit_score:  number;   // 0-100
  /** True only when qualified AND fit_score >= MIN_FIT_SCORE. */
  accepted:   boolean;
  /** Set when the model couldn't run (no key / parse fail) — caller may retry. */
  errored?:   boolean;
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Qualifies one prospect. NEVER THROWS. On any failure returns
 * { qualified:false, accepted:false, errored:true } so the lead is held, not sent.
 */
export async function qualifyProspect(input: QualifyInput): Promise<QualifyResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { qualified: false, reasons: "qualifier unavailable (no OpenAI key)", fit_score: 0, accepted: false, errored: true };
  }

  const vertical = input.vertical || "aesthetics";
  const isAesthetics = vertical.toLowerCase().includes("aesthetic");

  const system =
    `You are a strict B2B lead qualifier for a marketing agency whose ICP is ` +
    `owner-operated UK aesthetics clinics. You judge whether THIS business matches ` +
    `that profile from its website. You are sceptical and concise. Output STRICT JSON only.`;

  // The exact ICP — qualify checklist + hard disqualifiers from the owner.
  const icpBlock = isAesthetics
    ? [
        `IDEAL CUSTOMER PROFILE — owner-operated UK aesthetics clinic:`,
        `- Owner is the practitioner (nurse/doctor/aesthetician), 1-5 staff, in business 1+ years.`,
        `- High-ticket treatments (Botox, filler, skin boosters, fat dissolving, laser, profhilo);`,
        `  treatment value ~£150-£500, repeat clients worth £800-£2,000/yr.`,
        `- Appointment/consultation model with capacity to fill (could take ~10 more consults/week).`,
        ``,
        `STRONG POSITIVE SIGNALS (each raises the score):`,
        `- Already running Meta/Facebook ads OR clearly willing to (this ICP usually already spends`,
        `  ~£500-£3,000/mo on ads that underperform — that inconsistency is the gap we fill; do NOT`,
        `  penalise existing ads, it's a BUYING signal).`,
        `- Located in a city or large town (enough audience size).`,
        `- Has a booking system and a phone number on the site (leads can be called/booked).`,
        `- Owner actively involved (not absentee).`,
        ``,
        `HARD DISQUALIFIERS (any one → qualified:false, score < 40):`,
        `- Purely walk-in, no appointment model.`,
        `- No real online presence at all.`,
        `- Clearly tiny / hobbyist (would spend < £500/mo on ads).`,
        `- Part of a chain or franchise (decision-maker not accessible).`,
        `- Medical-only / surgical (cosmetic surgery, implants) — compliance too complex for now.`,
      ].join("\n")
    : [
        `FIT SIGNALS (industry is context, not a filter):`,
        `1. ROOM TO GROW — established, has capacity for more customers; not a solo/maxed-out`,
        `   operator and not a massive enterprise or franchise HQ.`,
        `2. HIGH-TICKET / GOOD LTV — each customer worth ~£150+ or strong repeat value.`,
        `3. REACHABLE & MARKETABLE — appointment model, online presence, owner accessible, and`,
        `   ads would plausibly grow them (already advertising imperfectly is a positive, not a minus).`,
      ].join("\n");

  const user = [
    `Decide if ${input.companyName} matches the ICP below.`,
    ``,
    `Business: ${input.companyName}${input.location ? ` (${input.location})` : ""}`,
    `Vertical: ${vertical}`,
    ``,
    input.websiteText
      ? `Scraped website text:\n${input.websiteText}`
      : `No website text could be retrieved — judge conservatively and lower the score for lack of evidence.`,
    ``,
    icpBlock,
    ``,
    `Scoring: a clean ICP match with strong signals scores 85-100; a likely match missing some`,
    `evidence scores 70-84; weak/unclear scores 40-69; any hard disqualifier scores below 40.`,
    ``,
    `Return JSON exactly: {"qualified": boolean, "reasons": string (1-2 sentences naming the`,
    `signals or disqualifier that drove it), "fit_score": number 0-100}. Set qualified=true only`,
    `when it's a real ICP match with no hard disqualifier.`,
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      temperature:     0.1,
      max_tokens:      300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { qualified?: unknown; reasons?: unknown; fit_score?: unknown };

    const fit_score = clampScore(parsed.fit_score);
    const qualified = parsed.qualified === true;
    const reasons = typeof parsed.reasons === "string" ? parsed.reasons : "";
    const accepted = qualified && fit_score >= MIN_FIT_SCORE;

    return { qualified, reasons, fit_score, accepted };
  } catch (err) {
    console.error("[qualifier] failed:", err instanceof Error ? err.message : err);
    return { qualified: false, reasons: "qualifier error", fit_score: 0, accepted: false, errored: true };
  }
}
