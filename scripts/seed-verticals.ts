/**
 * scripts/seed-verticals.ts  (Part 3 — Six Vertical Intelligence)
 *
 * Enriches the 6 PRIORITY verticals with DEEP, web-researched intelligence:
 *   - expertBrief (≥2000 words, 30-year-veteran voice, grounded in real research)
 *   - objectionPlaybook (top-10: objection / underlyingFear / responseFramework / closingLine)
 *   - callTimingData, seasonalPatterns, complianceNotes
 *   - 20 winning psychological frameworks per vertical → VectorKnowledge embeddings
 *
 * Source data: scripts/data/vertical-research.json — REAL CPL/objection/compliance/
 * seasonal/creative/targeting data gathered via live web search (NOT training-data
 * guesses). GPT-4o composes the long-form brief from that research so the numbers
 * are real. Upsert — safe to re-run; updates the 6 rows in place.
 *
 * Run:  npm run seed:verticals
 * (This is ADDITIVE to the legacy scripts/seedVerticals.ts which seeds 20 verticals'
 *  basic fields; this one writes the deep-intelligence fields for the 6 priorities.)
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Prisma } from "@prisma/client";
import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";   // app singleton — configured with the PrismaPg adapter (Prisma 7)
import { extractAndStorePattern } from "../src/lib/services/vectorKnowledgeService";

if (!process.env.OPENAI_API_KEY) { console.error("ERROR: OPENAI_API_KEY not set."); process.exit(1); }
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GBP_TO_USD = 1.27;

// Map research keys → canonical VerticalProfile.vertical keys + display names.
const VERTICAL_MAP: Record<string, { vertical: string; displayName: string; businessType: string }> = {
  aesthetics:         { vertical: "aesthetics",        displayName: "Aesthetics Clinics",   businessType: "owner-operated aesthetics clinic (Botox, filler, skin treatments)" },
  cosmetic_dentistry: { vertical: "cosmetic_dentistry", displayName: "Cosmetic Dentistry",   businessType: "cosmetic dental practice (veneers, implants, Invisalign, whitening)" },
  roofing:            { vertical: "roofing",           displayName: "Roofing",              businessType: "residential roofing contractor (repair & replacement)" },
  solar:              { vertical: "solar",             displayName: "Solar Installation",   businessType: "residential solar panel installation company" },
  hvac:               { vertical: "hvac",              displayName: "HVAC",                 businessType: "HVAC installation & repair company" },
  home_improvement:   { vertical: "home_improvement",  displayName: "Home Improvement",     businessType: "home improvement company (kitchens, bathrooms, windows, extensions)" },
};

interface ResearchObjection { objection: string; underlyingFear: string; responseFramework: string; closingLine: string; }
interface Research {
  key: string; vertical: string; cplBenchmarks: string; topObjections: ResearchObjection[];
  seasonalPatterns: string; complianceRules: string; creativeFormats: string;
  audienceTargeting: string; callTiming: string; leadQualitySignals: string; sources: string[];
}

interface GeneratedBrief {
  expertBrief: string;
  cplBenchmarkGbp: number;
  avgTransactionValueGbp: number;
  callTimingData: { bestDays: string[]; bestTimes: string[]; worstTimes: string[]; why: string };
  seasonalPatterns: Record<string, string>;       // month → trigger
  complianceNotes: string;
  vectorPatterns: string[];                         // 20 psychological frameworks
}

const BRIEF_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_deep_profile",
    description: "Compose a deep vertical intelligence profile grounded in the supplied research.",
    parameters: {
      type: "object",
      properties: {
        expertBrief: { type: "string", description: "MINIMUM 2000 words. Written as a 30-year veteran of running ads in this vertical. Must weave in the REAL CPL ranges, audience targeting, creative formats ranked with reasoning, seasonal calendar with triggers, buyer psychology, what kills campaigns, compliance landmines, call-timing data, hot-vs-cold lead signals, and the top objections with frameworks — all from the research provided." },
        cplBenchmarkGbp: { type: "number", description: "Representative Meta lead-gen CPL in GBP, derived from the research's real figures." },
        avgTransactionValueGbp: { type: "number", description: "Typical customer transaction/job value in GBP for this vertical." },
        callTimingData: {
          type: "object",
          properties: {
            bestDays: { type: "array", items: { type: "string" } },
            bestTimes: { type: "array", items: { type: "string" } },
            worstTimes: { type: "array", items: { type: "string" } },
            why: { type: "string" },
          },
          required: ["bestDays", "bestTimes", "worstTimes", "why"], additionalProperties: false,
        },
        seasonalPatterns: { type: "object", description: "Each of the 12 months (January..December) → a specific demand note + external trigger for this vertical.", additionalProperties: { type: "string" } },
        complianceNotes: { type: "string", description: "Every claim the AI caller must NEVER make, phrases that get ads banned, and the regulatory bodies governing this vertical (UK ASA/CAP/MHRA + US FTC where relevant), from the research." },
        vectorPatterns: { type: "array", items: { type: "string" }, description: "Exactly 20 WINNING psychological frameworks for ads in this vertical — the underlying mechanism (awareness state, emotion, objection pre-empted, proof mechanism), NOT specific ad copy. One sentence each." },
      },
      required: ["expertBrief", "cplBenchmarkGbp", "avgTransactionValueGbp", "callTimingData", "seasonalPatterns", "complianceNotes", "vectorPatterns"],
      additionalProperties: false,
    },
  },
};

async function composeProfile(meta: { displayName: string; businessType: string }, r: Research): Promise<GeneratedBrief> {
  const researchBlock = [
    `REAL CPL BENCHMARKS:\n${r.cplBenchmarks}`,
    `SEASONAL PATTERNS:\n${r.seasonalPatterns}`,
    `COMPLIANCE RULES:\n${r.complianceRules}`,
    `CREATIVE FORMATS THAT CONVERT:\n${r.creativeFormats}`,
    `AUDIENCE TARGETING:\n${r.audienceTargeting}`,
    `CALL TIMING:\n${r.callTiming}`,
    `LEAD QUALITY SIGNALS:\n${r.leadQualitySignals}`,
    `TOP OBJECTIONS:\n${r.topObjections.map((o) => `- "${o.objection}" (fear: ${o.underlyingFear})`).join("\n")}`,
  ].join("\n\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.4,
    max_tokens: 4096,
    messages: [
      { role: "system", content:
        `You are a 30-year veteran media buyer who has spent your entire career running paid ads for ${meta.businessType}. ` +
        `Compose a deep intelligence profile using ONLY the real research provided — cite the real numbers, never invent figures. ` +
        `The expertBrief MUST be at least 2000 words and read like hard-won field experience, not generic advice.` },
      { role: "user", content: `Business type: ${meta.businessType}\nVertical: ${meta.displayName}\n\nRESEARCH (real, current, web-sourced):\n${researchBlock}` },
    ],
    tools: [BRIEF_TOOL],
    tool_choice: { type: "function", function: { name: "create_deep_profile" } },
  });

  const call = res.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function" || !call.function?.arguments) throw new Error("no tool call");
  return JSON.parse(call.function.arguments) as GeneratedBrief;
}

async function main() {
  const dataPath = path.resolve(process.cwd(), "scripts/data/vertical-research.json");
  const research = JSON.parse(fs.readFileSync(dataPath, "utf8")) as Research[];
  console.log(`\n🌱 Deep vertical seed — ${research.length} priority verticals\n`);

  let ok = 0, failed = 0, patterns = 0;
  for (const r of research) {
    const meta = VERTICAL_MAP[r.key];
    if (!meta) { console.log(`  ⏭  skip unknown vertical "${r.key}"`); continue; }
    process.stdout.write(`[${meta.displayName}] composing brief…`);
    try {
      const g = await composeProfile(meta, r);
      const wordCount = g.expertBrief.split(/\s+/).length;

      // objectionPlaybook comes straight from the real research (verbatim objections).
      const objectionPlaybook = r.topObjections.slice(0, 10);

      await prisma.verticalProfile.upsert({
        where: { vertical: meta.vertical },
        create: {
          vertical: meta.vertical, displayName: meta.displayName,
          avgTransactionValueGbp: g.avgTransactionValueGbp, purchaseTimelineDays: 14,
          conversionGoalType: "formbooking", cplBenchmarkGbp: g.cplBenchmarkGbp,
          cplBenchmarkUsd: Math.round(g.cplBenchmarkGbp * GBP_TO_USD * 100) / 100,
          creativeStyle: "", audienceNotes: r.audienceTargeting.slice(0, 2000),
          targetingRecommendations: r.audienceTargeting.slice(0, 2000),
          bidStrategyNotes: "", offerStructure: "", callScriptNotes: "",
          performanceData: { sources: r.sources.slice(0, 30), seededAt: new Date().toISOString() },
          expertBrief: g.expertBrief, lastTrainedAt: new Date(),
          objectionPlaybook: objectionPlaybook as unknown as Prisma.InputJsonValue, callTimingData: g.callTimingData as unknown as Prisma.InputJsonValue,
          seasonalPatterns: g.seasonalPatterns as unknown as Prisma.InputJsonValue, complianceNotes: g.complianceNotes,
        },
        update: {
          avgTransactionValueGbp: g.avgTransactionValueGbp, cplBenchmarkGbp: g.cplBenchmarkGbp,
          cplBenchmarkUsd: Math.round(g.cplBenchmarkGbp * GBP_TO_USD * 100) / 100,
          audienceNotes: r.audienceTargeting.slice(0, 2000),
          targetingRecommendations: r.audienceTargeting.slice(0, 2000),
          expertBrief: g.expertBrief, lastTrainedAt: new Date(),
          objectionPlaybook: objectionPlaybook as unknown as Prisma.InputJsonValue, callTimingData: g.callTimingData as unknown as Prisma.InputJsonValue,
          seasonalPatterns: g.seasonalPatterns as unknown as Prisma.InputJsonValue, complianceNotes: g.complianceNotes,
          performanceData: { sources: r.sources.slice(0, 30), seededAt: new Date().toISOString() },
        },
      });

      // 20 winning psychological frameworks → vector knowledge (embedded + deduped).
      let stored = 0;
      for (const pat of g.vectorPatterns.slice(0, 20)) {
        const res = await extractAndStorePattern({ vertical: meta.vertical, psychPattern: pat, cplReduction: 0 });
        if (res.stored) stored++;
      }
      patterns += stored;

      process.stdout.write(` ✅ ${wordCount}w brief, ${objectionPlaybook.length} objections, ${stored} patterns (CPL £${g.cplBenchmarkGbp})\n`);
      if (wordCount < 2000) console.warn(`     ⚠️  brief under 2000 words (${wordCount})`);
      ok++;
    } catch (err) {
      process.stdout.write(` ❌ ${err instanceof Error ? err.message : "fail"}\n`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(48)}\n✅ profiles: ${ok}  ❌ failed: ${failed}  🧠 vector patterns: ${patterns}\n`);
  if (failed > 1) process.exit(1);
  console.log("Deep vertical seed complete. 🎉\n");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
