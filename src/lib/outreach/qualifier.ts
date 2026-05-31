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
  const system =
    `You are a strict B2B lead qualifier for a marketing agency that only takes ` +
    `established local ${vertical} businesses with high-ticket services. You are ` +
    `sceptical and concise. Output STRICT JSON only.`;

  const user = [
    `Assess whether this business is a good fit to be a marketing-agency client.`,
    ``,
    `Business: ${input.companyName}${input.location ? ` (${input.location})` : ""}`,
    `Vertical: ${vertical}`,
    ``,
    input.websiteText
      ? `Scraped website text:\n${input.websiteText}`
      : `No website text could be retrieved — judge conservatively from the name/vertical and lower the score for lack of evidence.`,
    ``,
    `Criteria:`,
    `1. Do they offer high-ticket services (typical transaction value > $150)?`,
    `2. Are they an ESTABLISHED local business — not a single-person freelancer, and not a massive untouchable enterprise/franchise HQ?`,
    ``,
    `Return JSON exactly: {"qualified": boolean, "reasons": string (1-2 sentences), "fit_score": number 0-100}.`,
    `Be strict: only score 75+ if BOTH criteria are clearly met.`,
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
