/**
 * src/lib/intelligence/decisionLibrary.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * ── CASE-BASED REASONING (CBR) FOR MARCUS ───────────────────────────────────
 * Human media buyers don't reason from rules — they reason from CASES: "this looks
 * like that Manchester roofing account in March; here's what worked." This module
 * gives Marcus the same instinct. Every vertical ships with hand-authored 30-year-
 * veteran expert cases, each expanded into realistic variations, embedded, and
 * stored in `DecisionExample` (pgvector). Before every diagnosis, Marcus retrieves
 * the 5 most similar past cases and reasons WITH them as precedents.
 *
 * The library is then kept alive by the self-learning pipeline
 * ({@link ../intelligence/selfLearningPipeline}) which promotes Marcus's own
 * executed decisions — scored 48h later against real Meta CPL — back into this
 * table as `self_learned` precedents. The longer the network runs, the sharper
 * every agent's instinct becomes.
 *
 * STORAGE: the `embedding vector(1536)` column is pgvector; Prisma has no native
 * vector type, so embeddings are read/written via raw SQL (mirrors
 * vectorKnowledgeService). Embeddings use OpenAI text-embedding-3-small.
 * NEVER THROWS on the read path; the seeder surfaces failures to the operator.
 */

import { prisma } from "@/lib/prisma";
import { openai, MODELS } from "@/lib/services/openaiClient";
import { mapPool } from "@/lib/utils/concurrency";

// ── Types ───────────────────────────────────────────────────────────────────
export interface DecisionCase {
  situation: string; // the campaign state a buyer would recognise
  diagnosis: string; // WHY it's happening (causal, specific)
  action:    string; // the single decisive move
  outcome:   string; // what happened next
  lesson:    string; // the transferable principle
}

interface SeedTemplate {
  vertical:    string; // MUST match CampaignBlueprint.vertical keys for CBR to fire
  displayName: string;
  cases:       DecisionCase[];
}

export interface RetrievedCase extends DecisionCase {
  distance: number; // cosine distance (lower = more similar)
}

const VARIATIONS_PER_CASE = 10;
const SEED_CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? 2); // OpenAI TPM-safe

// ── Vector helpers ────────────────────────────────────────────────────────────
/** pgvector literal: "[0.1,0.2,...]". */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** The text we embed for a case: the SITUATION is the match key (situation↔situation). */
function embeddingTextFor(situation: string): string {
  return situation.trim();
}

/** Embeds a single string → 1536-dim vector. Returns null if unavailable. NEVER THROWS. */
export async function generateRealEmbedding(text: string): Promise<number[] | null> {
  try {
    if (!process.env.OPENAI_API_KEY || !text.trim()) return null;
    const res = await openai.embeddings.create({ model: MODELS.embedding, input: text });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[decisionLibrary] embed failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Embeds many strings in one call (TPM-efficient). Returns same-length array; nulls on failure. */
async function generateEmbeddingsBatch(texts: string[]): Promise<(number[] | null)[]> {
  try {
    if (!process.env.OPENAI_API_KEY || texts.length === 0) return texts.map(() => null);
    const res = await openai.embeddings.create({ model: MODELS.embedding, input: texts });
    // The API returns embeddings in input order, indexed.
    const out: (number[] | null)[] = texts.map(() => null);
    for (const d of res.data) out[d.index] = d.embedding;
    return out;
  } catch (err) {
    console.error("[decisionLibrary] batch embed failed:", err instanceof Error ? err.message : err);
    return texts.map(() => null);
  }
}

// ── CBR retrieval (read path — used by Marcus before every diagnosis) ──────────
/**
 * The 5 (or `limit`) most similar past cases for this vertical, by cosine distance
 * over the situation embedding. NEVER THROWS — returns [] on any failure so the
 * media buyer always proceeds (CBR is an enhancement, never a dependency).
 */
export async function retrieveSimilarCases(
  vertical: string,
  situationText: string,
  limit = 5,
): Promise<RetrievedCase[]> {
  try {
    const vec = await generateRealEmbedding(embeddingTextFor(situationText));
    if (!vec) return [];
    const lit = toVectorLiteral(vec);
    const rows = await prisma.$queryRawUnsafe<RetrievedCase[]>(
      `SELECT situation, diagnosis, action, outcome, lesson,
              embedding <=> $1::vector AS distance
         FROM "DecisionExample"
        WHERE vertical = $2 AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      lit, vertical, limit,
    );
    return rows;
  } catch (err) {
    console.error("[decisionLibrary] retrieveSimilarCases failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Formats retrieved cases as a few-shot precedent block for the diagnosis prompt. */
export function formatPrecedentsForPrompt(cases: RetrievedCase[]): string {
  if (cases.length === 0) return "EXPERT PRECEDENTS: none on file yet for this vertical — reason from first principles.";
  const blocks = cases.map((c, i) =>
    `${i + 1}. SITUATION: ${c.situation}\n` +
    `   DIAGNOSIS: ${c.diagnosis}\n` +
    `   ACTION:    ${c.action}\n` +
    `   OUTCOME:   ${c.outcome}\n` +
    `   LESSON:    ${c.lesson}`,
  );
  return (
    `EXPERT PRECEDENTS — the ${cases.length} most similar past cases (case-based reasoning).\n` +
    `Reason WITH these the way a veteran does ("this looks like #2…"); adapt, don't copy:\n\n` +
    blocks.join("\n\n")
  );
}

// ── Insert (write path — seeding + self-learning both land here) ───────────────
function makeId(prefix: string, seed: number): string {
  // No Math.random reliance for determinism in logs; uniqueness from time + seed.
  return `${prefix}_${Date.now().toString(36)}${seed.toString(36)}${Math.round((seed * 2654435761) % 1e9).toString(36)}`;
}

export async function insertDecisionExample(
  row: DecisionCase & { vertical: string; source: string; quality: number; embedding: number[] | null; id?: string },
): Promise<void> {
  const id = row.id ?? makeId("dex", row.situation.length + row.lesson.length);
  if (row.embedding) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DecisionExample" (id, vertical, situation, diagnosis, action, outcome, lesson, embedding, source, quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      id, row.vertical, row.situation, row.diagnosis, row.action, row.outcome, row.lesson,
      toVectorLiteral(row.embedding), row.source, row.quality,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DecisionExample" (id, vertical, situation, diagnosis, action, outcome, lesson, source, quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      id, row.vertical, row.situation, row.diagnosis, row.action, row.outcome, row.lesson,
      row.source, row.quality,
    );
  }
}

// ── Variation generation (seeding) ────────────────────────────────────────────
function isValidCase(x: unknown): x is DecisionCase {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return ["situation", "diagnosis", "action", "outcome", "lesson"].every(
    (k) => typeof c[k] === "string" && (c[k] as string).trim().length > 0,
  );
}

/**
 * Expands one veteran base case into `n` realistic, DISTINCT variations (different
 * cities, budgets, metrics, sub-scenarios) that exhibit the same class of problem.
 * Returns [] on any failure — the base case alone is still seeded. NEVER THROWS.
 */
async function generateVariations(
  base: DecisionCase,
  displayName: string,
  n: number,
): Promise<DecisionCase[]> {
  try {
    if (!process.env.OPENAI_API_KEY) return [];
    const completion = await openai.chat.completions.create({
      model: MODELS.primary,
      temperature: 0.7,
      max_tokens: 2600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You are a Meta ads media buyer with 30 years of experience in the ${displayName} vertical. ` +
            `You are building a case library of expert decisions for an AI media buyer to learn from. ` +
            `Given ONE base case, write ${n} DISTINCT variations — same class of problem, but different ` +
            `cities, budgets (in GBP), CPL/CPM/CTR/frequency numbers, lead volumes, and nuances. ` +
            `Each must read like a real account a veteran has seen. Diagnoses must be causal and specific; ` +
            `actions must be a single decisive move within Meta's real levers (budget, pause, creative refresh, ` +
            `audience, learning-phase patience); outcomes must be concrete with numbers; lessons must be ` +
            `transferable principles. Respond ONLY as JSON: ` +
            `{"variations":[{"situation":string,"diagnosis":string,"action":string,"outcome":string,"lesson":string}, ...]}.`,
        },
        {
          role: "user",
          content:
            `BASE CASE:\n` +
            `SITUATION: ${base.situation}\nDIAGNOSIS: ${base.diagnosis}\nACTION: ${base.action}\n` +
            `OUTCOME: ${base.outcome}\nLESSON: ${base.lesson}\n\n` +
            `Write ${n} distinct variations now.`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { variations?: unknown };
    const arr = Array.isArray(parsed.variations) ? parsed.variations : [];
    return arr.filter(isValidCase).slice(0, n);
  } catch (err) {
    console.error("[decisionLibrary] generateVariations failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Seeder ────────────────────────────────────────────────────────────────────
export interface SeedReport {
  vertical: string;
  base:     number; // hand-authored gold cases inserted
  variations: number; // generated variations inserted
  total:    number;
  embedded: number; // how many got a real embedding (retrievable)
}

/**
 * Seeds the decision library for all SEED_TEMPLATES verticals. For each base case
 * it generates {@link VARIATIONS_PER_CASE} variations, embeds base+variations in a
 * single batch call, and inserts all via raw SQL with the vector type.
 *
 * Idempotent re-seed: deletes existing `seed`/`generated` rows for each vertical
 * first (never touches `self_learned` precedents Marcus has earned). Bounded
 * concurrency keeps us under the OpenAI TPM ceiling.
 */
export async function seedDecisionLibrary(): Promise<SeedReport[]> {
  // Flatten to (vertical, base-case) work items so concurrency is even across verticals.
  const work: Array<{ tmpl: SeedTemplate; base: DecisionCase; idx: number }> = [];
  for (const tmpl of SEED_TEMPLATES) {
    tmpl.cases.forEach((base, idx) => work.push({ tmpl, base, idx }));
  }

  // Clean re-seed: clear prior seed/generated rows per vertical (keep self_learned).
  const verticals = Array.from(new Set(SEED_TEMPLATES.map((t) => t.vertical)));
  for (const v of verticals) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "DecisionExample" WHERE vertical = $1 AND source IN ('seed','generated')`,
      v,
    );
  }

  const tally = new Map<string, SeedReport>();
  for (const v of verticals) {
    const display = SEED_TEMPLATES.find((t) => t.vertical === v)?.displayName ?? v;
    tally.set(v, { vertical: v, base: 0, variations: 0, total: 0, embedded: 0 });
    void display;
  }

  const settled = await mapPool(work, SEED_CONCURRENCY, async (item) => {
    const { tmpl, base } = item;
    const variations = await generateVariations(base, tmpl.displayName, VARIATIONS_PER_CASE);

    // base case = hand-authored gold (source 'seed', higher quality); variations 'generated'.
    const all: Array<{ c: DecisionCase; source: string; quality: number }> = [
      { c: base, source: "seed", quality: 0.9 },
      ...variations.map((c) => ({ c, source: "generated", quality: 0.8 })),
    ];

    const embeddings = await generateEmbeddingsBatch(all.map((x) => embeddingTextFor(x.c.situation)));

    let inserted = 0, embedded = 0, baseInserted = 0, varInserted = 0;
    for (let i = 0; i < all.length; i++) {
      const { c, source, quality } = all[i];
      const emb = embeddings[i];
      await insertDecisionExample({ ...c, vertical: tmpl.vertical, source, quality, embedding: emb });
      inserted++;
      if (emb) embedded++;
      if (source === "seed") baseInserted++; else varInserted++;
    }
    return { vertical: tmpl.vertical, baseInserted, varInserted, inserted, embedded };
  });

  for (const s of settled) {
    if (s.status !== "fulfilled" || !s.value) continue;
    const r = tally.get(s.value.vertical);
    if (!r) continue;
    r.base       += s.value.baseInserted;
    r.variations += s.value.varInserted;
    r.total      += s.value.inserted;
    r.embedded   += s.value.embedded;
  }

  return Array.from(tally.values());
}

// ── SEED_TEMPLATES ─────────────────────────────────────────────────────────────
// Vertical keys MUST match CampaignBlueprint.vertical so CBR fires for live clients.
// The six live priority verticals (hvac, aesthetics, cosmetic_dentistry, roofing,
// solar, home_improvement) plus hair_restoration (ready for launch). The spec's
// "Dental" maps to cosmetic_dentistry; "Aesthetics"/"Hair Restoration" are distinct.
export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    vertical: "hvac",
    displayName: "HVAC (install & repair)",
    cases: [
      {
        situation: "HVAC install campaign, daily budget £80, 18-day window. CPL £61 vs £34 vertical benchmark, CTR 0.7%, frequency 3.4, CPM up 28% week-on-week. Only 22 conversions.",
        diagnosis: "This is creative fatigue, not a targeting problem. Frequency 3.4 with a rising CPM on a flat audience means the same people are seeing the same ad too many times — the auction is charging more to keep showing it. The low CTR confirms the creative has stopped stopping the scroll.",
        action: "Held budget (do NOT scale into fatigue), flagged a creative refresh: new hook + new opening 3 seconds, same offer. Kept the winning audience untouched.",
        outcome: "New creative dropped frequency to 1.9 within 6 days, CTR recovered to 1.6%, CPL fell to £37. The audience was never the problem.",
        lesson: "Rising CPM + high frequency + falling CTR on a stable audience = creative fatigue. Refresh the creative; never scale budget into a fatigued ad — it just pays more for the same tired impressions.",
      },
      {
        situation: "New HVAC campaign, live 5 days, £100/day, £500 spent, 11 conversions, CPL £45 (benchmark £34). Owner is anxious and wants to pause it.",
        diagnosis: "The campaign is still in Meta's learning phase — under ~50 conversions, the delivery system hasn't finished optimising. CPL above benchmark this early is expected noise, not a signal. Pausing now resets the learner and wastes the £500 already spent buying that learning.",
        action: "Did NOT pause and did NOT scale. Held budget flat, let the learning phase complete, set a review for when conversions cross 50.",
        outcome: "By day 11 (54 conversions) the campaign exited learning and CPL settled at £31, below benchmark. Pausing on day 5 would have thrown that away.",
        lesson: "Never pause or scale a campaign in the learning phase on early CPL. Under ~50 conversions the number is noise. Patience is the single highest-ROI 'action' a buyer can take in week one.",
      },
      {
        situation: "HVAC repair campaign, £60/day, 21 days, CPL £24 (benchmark £34), frequency 1.6, CTR 2.1%, 70 conversions, calendar still has open slots. Clean winner.",
        diagnosis: "Genuine winner: CPL well below benchmark, healthy frequency, strong CTR, past learning phase with volume. Headroom exists and the client can take more jobs. Saturation risk is low at frequency 1.6.",
        action: "Scaled budget +20% (£60 → £72), one step, then monitored frequency and CPL for 48h before the next step. Did not double it — large jumps re-trigger learning.",
        outcome: "CPL held at £26 at the higher spend, conversions rose proportionally, frequency stayed under 2.0. Repeated the +20% step a week later.",
        lesson: "Scale winners in +20% steps, not leaps. Big budget jumps reset the learning phase and spike CPL. Only scale when frequency is healthy AND the client has capacity to service the extra leads.",
      },
    ],
  },
  {
    vertical: "aesthetics",
    displayName: "Aesthetics clinic (Botox, filler, skin)",
    cases: [
      {
        situation: "Aesthetics clinic, filler offer, £70/day, 14 days. Lots of leads (CPL £14, benchmark £22) but the clinic says they're low quality — tyre-kickers asking 'how much' and never booking.",
        diagnosis: "Cheap leads, expensive customers. A discount-led hook ('£99 filler!') is optimising for price-shoppers, not the high-LTV client. CPL looks great but conversion-to-consult is poor — the wrong people are filling the form.",
        action: "Kept budget, swapped the creative angle from price to outcome/credibility (results, practitioner expertise, safety). Added a soft qualifier to the form. Accepted a higher CPL deliberately.",
        outcome: "CPL rose to £26 but consult-show rate doubled and treatment bookings rose 40%. Cost per booked treatment fell despite the higher CPL.",
        lesson: "Optimise for cost-per-booked-treatment, not cost-per-lead. A discount hook buys cheap leads that never convert. In high-LTV aesthetics, a higher CPL from a credibility hook is usually the cheaper customer.",
      },
      {
        situation: "Aesthetics clinic, skin-treatment campaign, £90/day, frequency 2.8 and climbing, CTR slipping from 1.9% to 1.1% over 10 days, CPL drifting £22 → £30. Single broad audience.",
        diagnosis: "Early creative fatigue on a single audience — frequency 2.8 is the warning band before 3.0. The slipping CTR and drifting CPL are the leading indicators; left alone this becomes a 3.5-frequency money pit.",
        action: "Queued a creative refresh before frequency hit 3.0 (proactive, not reactive) and introduced a second creative concept to spread delivery. Did not touch budget.",
        outcome: "Frequency fell back to 1.8, CTR recovered to 1.8%, CPL returned to £21. Catching it at 2.8 avoided a week of £30 CPL.",
        lesson: "Act on fatigue at frequency 2.5–2.8, not after 3.0. The CTR slip is the early-warning siren — refresh creative before the CPL fully blows out, not after.",
      },
      {
        situation: "Aesthetics clinic, lip-filler launch, live 6 days, £120/day, £720 spent, 18 conversions, CPL £40 (benchmark £22). Owner wants it killed.",
        diagnosis: "Learning phase, not failure. 18 conversions is well under the ~50 needed to exit learning; £40 CPL on day 6 is noise. The offer and audience haven't been disproven yet — the data is too thin to conclude anything.",
        action: "Held the campaign, no pause, no scale. Explained the learning phase to the owner in plain English and set a checkpoint at 50 conversions.",
        outcome: "Crossed 50 conversions on day 12; CPL settled at £20, under benchmark. The owner's instinct to kill it on day 6 would have destroyed a winner.",
        lesson: "The most expensive mistake in aesthetics ads is killing a campaign during the learning phase because the owner panics. Educate, set a conversion-count checkpoint, and hold.",
      },
    ],
  },
  {
    vertical: "cosmetic_dentistry",
    displayName: "Cosmetic dentistry (veneers, implants, Invisalign)",
    cases: [
      {
        situation: "Implants campaign, £150/day, 20 days, CPL £55 (benchmark £48), frequency 2.2, CTR 1.4%. Leads come but the practice says most can't afford £12k implant cases.",
        diagnosis: "Affordability mismatch, not an ads problem per se. The targeting/creative isn't pre-qualifying for budget, so the funnel fills with people who want implants but can't fund them. The metrics look fine; the economics don't.",
        action: "Added finance messaging to the creative ('from £X/month') and an income/seriousness qualifier on the form; narrowed to higher-income geos/interests. Held budget.",
        outcome: "CPL rose to £68 but consult-to-treatment value jumped — fewer, better-funded leads, more accepted treatment plans. Revenue per ad pound improved markedly.",
        lesson: "For high-ticket dentistry, pre-qualify for affordability in the creative and the form. A slightly higher CPL that filters for funded patients beats a flood of cheap, unconvertible leads.",
      },
      {
        situation: "Invisalign campaign, £100/day, frequency 3.3, CPM up 35% MoM, CTR 0.8%, CPL £61 (benchmark £40). Same single creative running 4 weeks.",
        diagnosis: "Textbook fatigue + saturation. Four weeks on one creative at frequency 3.3 has exhausted the audience; the auction is charging a premium (CPM +35%) to keep delivering a tired ad nobody's clicking.",
        action: "Paused the fatigued creative, launched 3 fresh concepts (different hooks: confidence, speed, invisibility), kept the proven audience. Budget unchanged until a new winner emerged.",
        outcome: "Best new concept hit CTR 1.7%, frequency reset to 1.5, CPL fell to £38. CPM normalised once a fresh creative re-entered the auction.",
        lesson: "One creative cannot run for a month. Rotate concepts before frequency hits 3.0; a fresh creative resets both frequency and the CPM premium the auction was charging.",
      },
      {
        situation: "Veneers campaign, £80/day, 24 days, CPL £29 (benchmark £40), frequency 1.7, CTR 2.3%, 88 conversions, practice has chair time free. Strong.",
        diagnosis: "Clear winner with capacity to serve more: CPL 27% under benchmark, healthy frequency, high CTR, well past learning with volume. Scaling headroom is real.",
        action: "Scaled +20% and duplicated the winning ad set into one adjacent geo to widen reach without saturating the original audience. Monitored frequency.",
        outcome: "CPL held at £31 at higher spend; the new geo came in at £34, both under benchmark. Bookings rose ~25% with chair time absorbing them.",
        lesson: "When a winner has headroom and the client has capacity, scale +20% AND widen reach into an adjacent audience/geo — don't just pour budget into the original audience and drive frequency up.",
      },
    ],
  },
  {
    vertical: "roofing",
    displayName: "Roofing (repair & replacement)",
    cases: [
      {
        situation: "Roofing campaign, £120/day, 16 days, CPL £58 (benchmark £42), CTR 1.2%, frequency 2.1. A major storm is forecast in the region in 4 days.",
        diagnosis: "Current CPL is mediocre but a demand surge is imminent: storms drive a spike in roof-repair intent and search/social demand. Holding budget flat would mean under-capturing the cheapest, highest-intent leads of the quarter.",
        action: "Pre-positioned: raised budget ahead of the storm and refreshed creative to storm-relevant messaging ('storm damage? same-day inspection'). Scaled BEFORE the surge, not after.",
        outcome: "During and after the storm, CPL fell to £28 as intent spiked; the pre-raised budget captured volume competitors chasing the surge late paid more for.",
        lesson: "In weather-driven verticals, scale budget and align creative BEFORE the demand event, not after. The cheapest leads are at the front of the surge; reacting late means paying the premium everyone else is.",
      },
      {
        situation: "Roof-replacement campaign, £90/day, 19 days, CPL £39 (benchmark £42), frequency 1.8, CTR 1.9%, 61 conversions. Steady, slightly under benchmark.",
        diagnosis: "Quiet winner. Nothing is broken: CPL at/under benchmark, healthy frequency, past learning. The temptation is to fiddle, but the data says hold and take incremental gains.",
        action: "Made a single +15% budget step to test headroom, left creative and audience alone, set a 72h CPL/frequency review.",
        outcome: "CPL held at £40 at the higher budget, frequency stayed under 2.0. Confirmed headroom existed; queued another small step.",
        lesson: "Don't fix what isn't broken. A campaign at benchmark with healthy signals wants small, monitored budget steps — not constant creative/audience churn that re-triggers learning.",
      },
      {
        situation: "Roofing campaign, £100/day, frequency 3.6, CPL £71 (benchmark £42), CTR 0.6%, CPM the highest of any account this month. One creative, 5 weeks.",
        diagnosis: "Severe fatigue and audience saturation. Frequency 3.6 with rock-bottom CTR and a record CPM means the audience is exhausted and the auction is punishing the stale ad. This is actively wasting money every day it runs.",
        action: "Paused the creative immediately (frequency >3.0 = pause/replace, not 'monitor'), shipped two new concepts and broadened the audience to relieve saturation. Held budget until a winner emerged.",
        outcome: "Fresh creative + broader audience reset frequency to 1.4 and CTR to 1.8%; CPL fell to £40 within a week. The paused ad had been burning ~£60/day for nothing.",
        lesson: "Frequency ≥3.0 is a pause-now signal, not a watch-list item. Every day a 3.6-frequency ad runs is budget set on fire; replace creative and relieve saturation immediately.",
      },
    ],
  },
  {
    vertical: "solar",
    displayName: "Solar (residential panel installation)",
    cases: [
      {
        situation: "Solar campaign, £140/day, 22 days, CPL £33 (benchmark £45), but the installer says appointments don't show and those that do can't get finance. Lead volume high.",
        diagnosis: "Cheap leads, weak qualification. Solar is finance-sensitive; a low CPL with poor show/finance rates means the funnel is capturing curiosity, not committed, fundable buyers. The CPL flatters a broken downstream.",
        action: "Added homeownership + bill-size + finance qualifiers to the creative and form, shifted spend toward owner-occupier geos. Accepted a higher CPL for far better lead quality.",
        outcome: "CPL rose to £52 but show rate and finance-approval rate climbed sharply; installs per ad pound improved despite the higher CPL.",
        lesson: "In solar, a low CPL is meaningless if leads can't get finance or don't own the roof. Qualify hard up front (homeowner, bill size, finance) — cost-per-install is the only metric that pays.",
      },
      {
        situation: "Solar campaign, live 7 days, £160/day, £1,120 spent, 19 conversions, CPL £59 (benchmark £45). Agency owner wants to pause and reallocate.",
        diagnosis: "Learning phase. 19 conversions is far below the ~50 to exit; high CPL this early in an expensive vertical is normal. The campaign hasn't had the conversions to optimise delivery yet.",
        action: "Held — no pause, no reallocation. Set a 50-conversion checkpoint and let delivery stabilise.",
        outcome: "By day 14 (51 conversions) CPL settled at £41, under benchmark. The early panic would have wasted the learning already paid for.",
        lesson: "Expensive verticals take longer to clear the learning phase in absolute days because conversions accrue slower. Judge on the conversion count crossing ~50, never on day-7 CPL.",
      },
      {
        situation: "Solar campaign, £120/day, frequency 2.9, CTR sliding 1.6% → 1.0%, CPL £45 → £58 over 12 days, single creative. Spring (high-intent season) just starting.",
        diagnosis: "Creative fatigue colliding with the start of peak season — the worst time to let an ad go stale. Frequency 2.9 and a sliding CTR mean the creative is tiring exactly when demand is about to rise.",
        action: "Refreshed creative immediately to seasonal messaging (energy-bill/spring angle) and added a second concept; left the proven audience and budget in place to ride the season on fresh creative.",
        outcome: "CTR recovered to 1.7%, frequency dropped to 1.6, CPL fell to £40 just as seasonal demand lifted volume. Entered peak season with a fresh, winning creative.",
        lesson: "Never enter a high-intent season on a fatiguing creative. Refresh ahead of the seasonal lift so you capture peak demand at a low CPL instead of a tired ad at a high one.",
      },
    ],
  },
  {
    vertical: "home_improvement",
    displayName: "Home improvement (kitchens, bathrooms, windows, extensions)",
    cases: [
      {
        situation: "Kitchens campaign, £110/day, 18 days, CPL £47 (benchmark £55), frequency 1.9, CTR 1.8%, 64 conversions, fitter has a 6-week backlog already.",
        diagnosis: "Strong performance BUT the client is at capacity — a 6-week backlog means more leads now would damage the customer experience and waste spend on jobs that can't be served promptly.",
        action: "Did NOT scale despite the headroom. Held budget to match fulfilment capacity and flagged to the agency owner that demand exceeds supply — the constraint is the fitter, not the ads.",
        outcome: "Avoided generating leads that would have aged in a queue and churned. When the backlog cleared, scaled +20% into the freed capacity.",
        lesson: "Scaling is governed by fulfilment capacity, not just ad metrics. Generating leads a client can't service on time burns money and reputation. Match lead flow to capacity; scale when capacity frees up.",
      },
      {
        situation: "Windows campaign, £90/day, frequency 3.2, CPL £78 (benchmark £55), CTR 0.7%, CPM rising. Same creative 5 weeks.",
        diagnosis: "Creative fatigue with saturation: frequency 3.2, collapsing CTR, rising CPM. The audience has seen this ad too often and the auction is charging more to keep delivering it.",
        action: "Paused the tired creative, launched fresh concepts with a new hook and broadened the audience to cut overlap/saturation. Held budget until a winner emerged.",
        outcome: "Frequency reset to 1.5, CTR rose to 1.6%, CPL fell to £52. CPM normalised once fresh creative entered the auction.",
        lesson: "Five weeks on one creative guarantees fatigue. Frequency >3.0 means pause and replace immediately, and widen the audience to relieve saturation — don't just swap the image and keep a too-narrow audience.",
      },
      {
        situation: "Bathrooms campaign, £130/day, 9 days, £1,170 spent, 24 conversions, CPL £49 (benchmark £55). Below benchmark but owner wants to scale aggressively NOW.",
        diagnosis: "Promising but still in/near the learning phase (24 conversions). A big budget jump now would reset learning and likely spike CPL — the right instinct (it's working) with the wrong size of move.",
        action: "Resisted the aggressive scale. Made one +20% step, let it stabilise, and queued the next step after the conversion count cleared 50 and CPL held.",
        outcome: "After clearing 50 conversions, stepped budget up twice more; CPL stayed in the £48–£52 band. Aggressive scaling on day 9 would have re-triggered learning and spiked CPL.",
        lesson: "Even a winner gets scaled in +20% steps once out of learning. Aggressive jumps reset the learner and undo the very performance you're trying to scale.",
      },
    ],
  },
  {
    vertical: "hair_restoration",
    displayName: "Hair restoration (FUE/FUT transplants)",
    cases: [
      {
        situation: "Hair-transplant campaign, £130/day, 20 days, CPL £21 (benchmark £38), high volume, but the clinic says leads are early-stage browsers who won't commit to a £5k FUE procedure.",
        diagnosis: "A cheap, top-of-funnel hook is pulling in curiosity rather than commitment. Transplants are high-consideration, high-ticket — a low CPL here usually signals the creative is attracting researchers, not buyers ready to book a consult.",
        action: "Shifted the creative from curiosity ('thinning hair?') to credibility and outcome (surgeon results, before/after, finance from £X/month) and added a readiness qualifier. Accepted a higher CPL.",
        outcome: "CPL rose to £41 but consult-booking and procedure-conversion rates climbed sharply; cost per booked procedure dropped despite the higher lead cost.",
        lesson: "For high-ticket, high-consideration procedures, a very low CPL is a warning, not a win — it means you're paying for browsers. Lead with credibility and finance; measure cost per booked procedure.",
      },
      {
        situation: "Hair-restoration campaign, £100/day, frequency 3.1, CTR 0.7%, CPL £64 (benchmark £38), one creative running 6 weeks, CPM elevated.",
        diagnosis: "Fatigue and saturation in a niche audience that exhausts faster than broad verticals. Frequency 3.1 with a collapsed CTR means the limited eligible audience has seen this ad too many times; the auction is charging a premium.",
        action: "Paused the fatigued creative, shipped fresh concepts (different angle: confidence, permanence, natural results), and broadened targeting cautiously to enlarge the eligible pool. Held budget.",
        outcome: "Frequency fell to 1.6, CTR recovered to 1.5%, CPL dropped to £37. The narrow audience had simply been over-served by a single stale ad.",
        lesson: "Niche, high-ticket audiences saturate faster — watch frequency even more closely. At ≥3.0, pause and refresh, and carefully widen the eligible pool to relieve saturation.",
      },
      {
        situation: "Hair-transplant campaign, £90/day, 26 days, CPL £30 (benchmark £38), frequency 1.7, CTR 1.9%, 58 consults booked, surgeon has theatre availability. Solid winner.",
        diagnosis: "Genuine winner with capacity: CPL under benchmark, healthy frequency, past learning with real consult volume, and the clinic can take more procedures. Scaling headroom is real.",
        action: "Scaled +20% in one step and duplicated the winning ad set into an adjacent metro to widen reach without over-serving the original audience. Monitored frequency and CPL for 48h.",
        outcome: "CPL held at £33 at higher spend; the new metro came in at £36, both under benchmark. Consult volume rose with theatre time absorbing it.",
        lesson: "Scale proven high-ticket winners in +20% steps and expand reach into adjacent metros rather than over-serving one audience — but only when the clinic genuinely has theatre capacity for the extra procedures.",
      },
    ],
  },
];
