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


import { openai } from "@/lib/services/openaiClient";
import { nicheConfig } from "@/lib/outreach/niche";
import { detectRegion } from "@/lib/outreach/regional";

export const MIN_FIT_SCORE = 75;

export interface QualifyInput {
  companyName: string;
  location?:   string;
  vertical?:   string;
  country?:    string;   // ISO-ish; drives currency in the ICP rubric
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

  const vertical = input.vertical || "local_business";
  const niche = nicheConfig(vertical);
  const region = detectRegion(input.country);
  const cur = region === "US" ? "$" : "£"; // launch market is UK → £

  const system =
    `You are a strict B2B lead qualifier for a marketing agency. The ICP is the SAME across ` +
    `every niche: owner-operated / independent LOCAL service businesses — premium operators ` +
    `where the OWNER is the decision-maker. This prospect is a ${niche.noun} (${niche.service}). ` +
    `Judge whether THIS business matches the ICP from its website. Sceptical and concise. ` +
    `Output STRICT JSON only.`;

  // The ICP is identical across niches — only the trade noun/service changes.
  const icpBlock = [
    `IDEAL CUSTOMER PROFILE — owner-operated ${niche.noun} (applies to ALL our niches):`,
    `- Independent / owner-operated; the owner/founder/director is the decision-maker (NOT a chain,`,
    `  franchise, or national HQ where you can't reach the person who says yes).`,
    `- Established (1+ years) with capacity to take on more work — not a maxed-out solo operator and`,
    `  not a huge enterprise.`,
    `- High-ticket / good LTV: each customer is worth real money (${cur}-hundreds to ${cur}-thousands)`,
    `  on an appointment/job/quote model where ${niche.service} is the revenue driver.`,
    ``,
    `STRONG POSITIVE SIGNALS (each raises the score):`,
    `- Already running Meta/Facebook/Google ads OR clearly willing to — this ICP usually already`,
    `  spends on ads that underperform; that inconsistency is the gap we fill. Do NOT penalise`,
    `  existing ads, it's a BUYING signal.`,
    `- Serves a defined LOCAL market (a city or large town — enough demand).`,
    `- Has a phone number and/or booking/enquiry form on the site (leads can be called + booked).`,
    `- Owner actively involved (not absentee / not a faceless brand).`,
    ``,
    `HARD DISQUALIFIERS (any one → qualified:false, score < 40):`,
    `- Part of a chain / franchise / national brand (decision-maker not accessible).`,
    `- No real online presence at all.`,
    `- Clearly tiny / hobbyist (no real ad budget) OR a massive enterprise.`,
    `- Not a local service business / no appointment-or-job model (e.g. pure e-commerce, info site).`,
  ].join("\n");

  const user = [
    `Decide if ${input.companyName} matches the ICP below.`,
    ``,
    `Business: ${input.companyName}${input.location ? ` (${input.location})` : ""}`,
    `Niche: ${niche.noun} — ${niche.service}`,
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
