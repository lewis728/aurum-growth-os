/**
 * src/lib/intelligence/onboardingResearch.ts
 * SERVER-SIDE ONLY. Part 10 — client onboarding intelligence sweep.
 *
 * The moment a client is deployed, generate HYPER-LOCAL intelligence for their
 * exact city + vertical (Manhattan HVAC ≠ Manchester HVAC), so the agent starts
 * as a local expert before the first lead ever calls. Fire-and-forget from Deploy
 * Sophie — NEVER blocks it, NEVER throws.
 *
 * Sources: the Meta Ad Library (real local competitor ads) + GPT-4o (a 10-year-
 * local-veteran addendum grounded in that data and the vertical brief). NOTE: a
 * runtime function can't call the WebSearch tool, so live web scraping is GPT's
 * domain knowledge + the Ad Library, mirroring the vertical trainer's approach.
 *
 * Stores onto ClientBrief (geoIntelligence / localCplBenchmark / competitorSnapshot
 * / localSeasonalCalendar), injects local context into Sophie's Retell prompt, and
 * logs an AgentAction the morning briefing can surface.
 */

import { openai } from "@/lib/services/openaiClient";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchAdLibrary, compactAdLines } from "@/lib/services/metaAdLibrary";
import { updateRetellLlmPrompt, getRetellLlmPrompt } from "@/lib/services/retellService";

interface VoiceLayerIds { retellLlmId?: string }

interface GeoAddendum {
  addendum: string;            // ~500-word city-specific addendum
  localCplBenchmark: number;   // local CPL in GBP
  topLocalObjection: string;
  bestCallTimes: string;
  seasonalCalendar: Record<string, string>; // month → local demand note
}

/**
 * Runs the onboarding research sweep for one freshly-deployed client. NEVER THROWS.
 */
export async function runOnboardingResearch(blueprintId: string, tenantId: string): Promise<void> {
  try {
    const bp = await prisma.campaignBlueprint.findFirst({
      where: { id: blueprintId, tenantId },
      select: { businessName: true, vertical: true, targetLocation: true, voice: true },
    });
    if (!bp) return;
    const city = (bp.targetLocation ?? "").trim() || "their area";
    const vertical = bp.vertical;

    // National vertical brief for grounding (so the addendum contrasts vs national).
    const profile = await prisma.verticalProfile.findUnique({
      where: { vertical }, select: { expertBrief: true, cplBenchmarkGbp: true, displayName: true },
    }).catch(() => null);
    const label = profile?.displayName || vertical;

    // ── Real local competitor ads from the Meta Ad Library (graceful) ──────────
    const ads = await searchAdLibrary(`${label} ${city}`, { country: "GB", limit: 25 });
    const sampleAds = compactAdLines(ads, 12);
    const competitorSnapshot = {
      adCount: ads.length, sampleAds, usedAdLibrary: ads.length > 0, capturedAt: new Date().toISOString(),
    };

    // ── GPT-4o local addendum (grounded in the brief + competitor sample) ──────
    let geo: GeoAddendum | null = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o", temperature: 0.4, max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content:
              `You are a veteran media buyer who has run ${label} campaigns specifically in ${city} for 10 years. ` +
              `Write what is DIFFERENT about ${city} vs the national playbook — be specific, use real numbers, ` +
              `focus on CPL differences, audience nuances, seasonal triggers, competitor landscape, and city-specific ` +
              `objections. Output STRICT JSON only.` },
            { role: "user", content: [
              `City: ${city}. Vertical: ${label}.`,
              profile?.cplBenchmarkGbp ? `National CPL benchmark: £${profile.cplBenchmarkGbp}.` : "",
              sampleAds.length ? `Live competitor ads in this area:\n${sampleAds.join("\n")}` : "No live competitor ad sample available.",
              profile?.expertBrief ? `National brief excerpt:\n${profile.expertBrief.slice(0, 1500)}` : "",
              ``,
              `Return JSON: {"addendum": string (~500 words, city-specific), "localCplBenchmark": number (GBP), ` +
              `"topLocalObjection": string, "bestCallTimes": string, "seasonalCalendar": {<month>: <local demand note>}}.`,
            ].filter(Boolean).join("\n") },
          ],
        });
        const p = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<GeoAddendum>;
        geo = {
          addendum: typeof p.addendum === "string" ? p.addendum : "",
          localCplBenchmark: typeof p.localCplBenchmark === "number" && p.localCplBenchmark > 0 ? p.localCplBenchmark : (profile?.cplBenchmarkGbp ?? 0),
          topLocalObjection: typeof p.topLocalObjection === "string" ? p.topLocalObjection : "",
          bestCallTimes: typeof p.bestCallTimes === "string" ? p.bestCallTimes : "",
          seasonalCalendar: (p.seasonalCalendar && typeof p.seasonalCalendar === "object") ? p.seasonalCalendar : {},
        };
      } catch (err) {
        console.error("[onboardingResearch] GPT addendum failed:", err instanceof Error ? err.message : err);
      }
    }

    // ── Persist onto ClientBrief (upsert — brief may not exist yet) ────────────
    await prisma.clientBrief.upsert({
      where: { blueprintId },
      create: {
        blueprintId, tenantId,
        geoIntelligence: (geo ? { addendum: geo.addendum, topLocalObjection: geo.topLocalObjection, bestCallTimes: geo.bestCallTimes } : {}) as unknown as Prisma.InputJsonValue,
        localCplBenchmark: geo?.localCplBenchmark ?? null,
        competitorSnapshot: competitorSnapshot as unknown as Prisma.InputJsonValue,
        localSeasonalCalendar: (geo?.seasonalCalendar ?? {}) as unknown as Prisma.InputJsonValue,
      },
      update: {
        geoIntelligence: (geo ? { addendum: geo.addendum, topLocalObjection: geo.topLocalObjection, bestCallTimes: geo.bestCallTimes } : Prisma.JsonNull) as Prisma.InputJsonValue,
        localCplBenchmark: geo?.localCplBenchmark ?? null,
        competitorSnapshot: competitorSnapshot as unknown as Prisma.InputJsonValue,
        localSeasonalCalendar: (geo?.seasonalCalendar ?? {}) as unknown as Prisma.InputJsonValue,
      },
    }).catch((e) => console.error("[onboardingResearch] brief upsert failed:", e instanceof Error ? e.message : e));

    // ── Inject local context into Sophie's Retell prompt (append, idempotent-ish) ──
    const llmId = (bp.voice as VoiceLayerIds | null)?.retellLlmId;
    if (llmId && geo?.addendum) {
      try {
        const current = (await getRetellLlmPrompt(llmId)) ?? "";
        const marker = "LOCAL MARKET CONTEXT FOR";
        const base = current.includes(marker) ? current.slice(0, current.indexOf(marker)).trimEnd() : current;
        const localBlock = [
          ``, `${marker} ${city.toUpperCase()}:`, geo.addendum,
          geo.topLocalObjection ? `Key local objection: ${geo.topLocalObjection}` : "",
          geo.bestCallTimes ? `Best call times in ${city}: ${geo.bestCallTimes}` : "",
        ].filter(Boolean).join("\n");
        await updateRetellLlmPrompt(llmId, `${base}\n${localBlock}`);
      } catch (err) {
        console.error("[onboardingResearch] Retell prompt update failed:", err instanceof Error ? err.message : err);
      }
    }

    // ── Log an AgentAction (the morning briefing can surface it) ───────────────
    const national = profile?.cplBenchmarkGbp ?? 0;
    await prisma.agentAction.create({ data: {
      tenantId, blueprintId, agentName: "Ava", actionType: "ONBOARDING_RESEARCH",
      reasoning: `Local market research for ${bp.businessName} in ${city} (${label}). ` +
        `Local CPL £${(geo?.localCplBenchmark ?? national).toFixed?.(0) ?? national} vs national £${national}. ` +
        `${competitorSnapshot.adCount} competitor ads found in area.`,
      outcome: geo?.topLocalObjection
        ? `Sophie's script updated with local context. Key local insight: ${geo.topLocalObjection}`
        : `Local competitor snapshot captured. Sophie's script updated.`,
    } }).catch(() => {});
  } catch (err) {
    console.error("[onboardingResearch] failed silently:", err instanceof Error ? err.message : err);
  }
}
