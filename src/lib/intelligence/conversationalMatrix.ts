/**
 * src/lib/intelligence/conversationalMatrix.ts
 * SERVER-SIDE ONLY. Layer 6 (Part 7) — the conversational linguistics matrix.
 *
 * After every call/SMS outcome we record the objection language used, the city +
 * vertical, the response, and whether it converted (ConversationalPattern). Once a
 * city accumulates enough samples we distil a CityPersona (the proven linguistic
 * model for that city) into VerticalProfile.geoIntelligence, and Sophie pulls it
 * before every call instead of starting from a generic script.
 *
 * Everything here NEVER THROWS — learning must never break a call or an SMS.
 */

import { openai } from "@/lib/services/openaiClient";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const PERSONA_MIN_SAMPLES = 30;   // build a CityPersona once a city has this many
const AB_PROMOTE_SAMPLES = 20;    // promote an A/B winner after this many trials
const AB_NEW_THRESHOLD = 10;      // a city/objection with < this is "new" → A/B test

export type ObjectionType = "price" | "time" | "trust" | "competitor" | "logistics" | "other";

/** Normalises a free-text location ("Leeds, UK", "Austin, TX") to a city slug. */
export function cityOf(location: string | null | undefined): string {
  const raw = (location ?? "").split(",")[0]?.trim().toLowerCase();
  return raw && raw.length > 1 ? raw.replace(/\s+/g, "_") : "unknown";
}

/** Cheap deterministic objection classifier (no LLM) for the hot path. */
export function classifyObjection(text: string): ObjectionType {
  const t = (text ?? "").toLowerCase();
  if (/\b(price|cost|expensive|afford|cheap|how much|£|\$|quote)\b/.test(t)) return "price";
  if (/\b(time|busy|later|next week|not now|think about|too soon)\b/.test(t)) return "time";
  if (/\b(scam|trust|legit|reviews?|guarantee|burned|sceptic|skeptic)\b/.test(t)) return "trust";
  if (/\b(competitor|someone else|another|already (have|using)|shopping around)\b/.test(t)) return "competitor";
  if (/\b(location|far|travel|park|where|downtime|recovery|aftercare)\b/.test(t)) return "logistics";
  return "other";
}

export interface RecordPatternInput {
  tenantId: string;
  vertical: string;
  location: string | null;
  objectionVerbatim: string;
  responseUsed?: string | null;
  converted: boolean;
  country?: string;
}

/**
 * Records one observed objection→outcome. Dedup-light: if an identical
 * (city, vertical, objectionType) confirmed pattern exists, bump its sample/score
 * instead of inserting noise. NEVER THROWS.
 */
export async function recordPattern(input: RecordPatternInput): Promise<void> {
  try {
    const city = cityOf(input.location);
    const objectionType = classifyObjection(input.objectionVerbatim);
    await prisma.conversationalPattern.create({
      data: {
        tenantId: input.tenantId,
        vertical: input.vertical,
        city,
        country: input.country ?? "GB",
        objectionType,
        objectionVerbatim: input.objectionVerbatim.slice(0, 2000),
        responseUsed: input.responseUsed?.slice(0, 2000) ?? null,
        converted: input.converted,
        confidenceScore: input.converted ? 1 : 0,
      },
    });
    // Opportunistically (re)build the CityPersona once there's enough signal.
    await maybeBuildCityPersona(input.vertical, city).catch(() => {});
  } catch (err) {
    console.error("[conversationalMatrix] recordPattern failed:", err instanceof Error ? err.message : err);
  }
}

export interface CityPersona {
  primaryObjection: string;
  buyingStyle: string;
  languageStyle: string;
  mustAvoid: string;
  winningFrameworks: string[];
  exampleWinningResponse: string;
  sampleSize: number;
  builtAt: string;
}

/** Builds a CityPersona from accumulated patterns once ≥30 samples exist. NEVER THROWS. */
async function maybeBuildCityPersona(vertical: string, city: string): Promise<void> {
  const samples = await prisma.conversationalPattern.findMany({
    where: { vertical, city },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { objectionType: true, objectionVerbatim: true, responseUsed: true, converted: true },
  });
  if (samples.length < PERSONA_MIN_SAMPLES) return;
  if (!process.env.OPENAI_API_KEY) return;

  const won = samples.filter((s) => s.converted);
  const lost = samples.filter((s) => !s.converted);
  const summary = [
    `WON conversations (${won.length}):`,
    ...won.slice(0, 20).map((s) => `- [${s.objectionType}] "${s.objectionVerbatim.slice(0, 120)}" → ${(s.responseUsed ?? "").slice(0, 120)}`),
    `LOST conversations (${lost.length}):`,
    ...lost.slice(0, 20).map((s) => `- [${s.objectionType}] "${s.objectionVerbatim.slice(0, 120)}"`),
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", temperature: 0.3, max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content:
          `You distil a city-level conversational persona for an AI appointment-setter working ${vertical} leads in ${city}. ` +
          `From the real won/lost conversations, infer what actually converts there. Output STRICT JSON only.` },
        { role: "user", content:
          `${summary}\n\nReturn JSON: {"primaryObjection": string, "buyingStyle": string, "languageStyle": string, ` +
          `"mustAvoid": string, "winningFrameworks": string[], "exampleWinningResponse": string}.` },
      ],
    });
    const p = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<CityPersona>;
    const persona: CityPersona = {
      primaryObjection: p.primaryObjection ?? "", buyingStyle: p.buyingStyle ?? "",
      languageStyle: p.languageStyle ?? "", mustAvoid: p.mustAvoid ?? "",
      winningFrameworks: Array.isArray(p.winningFrameworks) ? p.winningFrameworks : [],
      exampleWinningResponse: p.exampleWinningResponse ?? "",
      sampleSize: samples.length, builtAt: new Date().toISOString(),
    };

    // Merge into VerticalProfile.geoIntelligence.cityPersonas[city].
    const profile = await prisma.verticalProfile.findUnique({
      where: { vertical }, select: { geoIntelligence: true },
    });
    const geo = (profile?.geoIntelligence && typeof profile.geoIntelligence === "object" && !Array.isArray(profile.geoIntelligence))
      ? (profile.geoIntelligence as Record<string, unknown>) : {};
    const cityPersonas = (geo.cityPersonas && typeof geo.cityPersonas === "object")
      ? (geo.cityPersonas as Record<string, unknown>) : {};
    cityPersonas[city] = persona;
    await prisma.verticalProfile.update({
      where: { vertical },
      data: { geoIntelligence: { ...geo, cityPersonas } as unknown as Prisma.InputJsonValue },
    }).catch(() => {});
  } catch (err) {
    console.error("[conversationalMatrix] buildCityPersona failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Fetches the proven CityPersona for a city+vertical to inject into Sophie's call.
 * Returns null when none exists yet (she falls back to the generic script). NEVER THROWS.
 */
export async function getCityPersona(vertical: string, location: string | null | undefined): Promise<CityPersona | null> {
  try {
    const city = cityOf(location);
    const profile = await prisma.verticalProfile.findUnique({
      where: { vertical }, select: { geoIntelligence: true },
    });
    const geo = profile?.geoIntelligence;
    if (!geo || typeof geo !== "object" || Array.isArray(geo)) return null;
    const personas = (geo as Record<string, unknown>).cityPersonas;
    if (!personas || typeof personas !== "object") return null;
    const p = (personas as Record<string, unknown>)[city];
    return p ? (p as CityPersona) : null;
  } catch {
    return null;
  }
}

/** Renders a CityPersona into a compact string for Retell dynamic variables. */
export function renderPersonaForCall(persona: CityPersona | null): string {
  if (!persona) return "";
  return [
    `LOCAL CONVERSATIONAL MODEL (proven in this city):`,
    `Primary objection: ${persona.primaryObjection}`,
    `Buying style: ${persona.buyingStyle}`,
    `Language style: ${persona.languageStyle}`,
    `Must avoid: ${persona.mustAvoid}`,
    persona.winningFrameworks.length ? `Winning frameworks: ${persona.winningFrameworks.join("; ")}` : "",
    persona.exampleWinningResponse ? `Example that converts here: "${persona.exampleWinningResponse}"` : "",
  ].filter(Boolean).join("\n");
}

export interface AbVariant { objectionType: ObjectionType; variants: string[]; variantGroup: string; }

/**
 * When a new objection pattern appears in a city with < AB_NEW_THRESHOLD samples,
 * generates 5 response variants to A/B test. NEVER THROWS; [] if unavailable.
 */
export async function generateResponseVariants(vertical: string, city: string, objectionVerbatim: string): Promise<AbVariant | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const objectionType = classifyObjection(objectionVerbatim);
  try {
    const existing = await prisma.conversationalPattern.count({ where: { vertical, city, objectionType } });
    if (existing >= AB_NEW_THRESHOLD) return null; // already enough signal, no need to test
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", temperature: 0.8, max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `You write objection-handling responses for an AI appointment-setter in ${city} ${vertical}. Output STRICT JSON only.` },
        { role: "user", content: `Objection: "${objectionVerbatim}". Write 5 DISTINCT short response approaches to test. Return JSON: {"variants": string[5]}.` },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { variants?: string[] };
    const variants = Array.isArray(parsed.variants) ? parsed.variants.slice(0, 5) : [];
    if (variants.length === 0) return null;
    return { objectionType, variants, variantGroup: `${vertical}:${city}:${objectionType}:${Date.now().toString(36)}` };
  } catch (err) {
    console.error("[conversationalMatrix] generateResponseVariants failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export { PERSONA_MIN_SAMPLES, AB_PROMOTE_SAMPLES, AB_NEW_THRESHOLD };
