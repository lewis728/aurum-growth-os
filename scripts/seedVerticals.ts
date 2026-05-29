/**
 * scripts/seedVerticals.ts
 * One-time seed script. Generates all 20 vertical profiles using GPT-4o.
 *
 * Run with:
 *   npx ts-node --project tsconfig.scripts.json scripts/seedVerticals.ts
 *
 * Or via package.json script:
 *   pnpm seed:verticals
 *
 * Prerequisites:
 *   - DATABASE_URL must be set in .env.local
 *   - OPENAI_API_KEY must be set in .env.local
 *
 * Behaviour:
 *   - Idempotent: skips verticals that already have a profile in the DB
 *   - Logs progress to stdout with timestamps
 *   - Exits with code 1 if more than 3 profiles fail to generate
 *
 * The 20 verticals:
 *   10 × ServiceVertical enum members (law, aesthetics, dental, hvac, roofing)
 *   10 × GENERAL_ custom verticals (fitness, real estate, bakery, plumber, etc.)
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local before importing anything that uses env vars
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import type { ChatCompletionMessageFunctionToolCall } from "openai/resources/chat/completions";

// ── Clients ───────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set. Exiting.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Constants ─────────────────────────────────────────────────────────────────

const GBP_TO_USD_RATE = 1.27;

// ── Seed Targets ──────────────────────────────────────────────────────────────

interface SeedTarget {
  vertical: string;
  businessType: string;
  displayName: string;
}

const SEED_TARGETS: SeedTarget[] = [
  // ── ServiceVertical enum members ──────────────────────────────────────────
  {
    vertical: "law.personal_injury",
    businessType: "personal injury law firm in the UK",
    displayName: "Law — Personal Injury",
  },
  {
    vertical: "law.family",
    businessType: "family law solicitors in the UK",
    displayName: "Law — Family",
  },
  {
    vertical: "law.criminal",
    businessType: "criminal defence solicitors in the UK",
    displayName: "Law — Criminal Defence",
  },
  {
    vertical: "aesthetics.anti_wrinkle_filler",
    businessType: "aesthetics clinic specialising in anti-wrinkle injections and dermal fillers in the UK",
    displayName: "Aesthetics — Anti-Wrinkle & Fillers",
  },
  {
    vertical: "aesthetics.laser_hair_removal",
    businessType: "aesthetics clinic specialising in laser hair removal in the UK",
    displayName: "Aesthetics — Laser Hair Removal",
  },
  {
    vertical: "dental.implants",
    businessType: "dental practice specialising in dental implants in the UK",
    displayName: "Dental — Implants",
  },
  {
    vertical: "dental.whitening",
    businessType: "dental practice offering teeth whitening and cosmetic dentistry in the UK",
    displayName: "Dental — Whitening",
  },
  {
    vertical: "hvac.installation",
    businessType: "HVAC installation company for residential and commercial properties in the UK",
    displayName: "HVAC — Installation",
  },
  {
    vertical: "hvac.repair",
    businessType: "HVAC repair and maintenance company in the UK",
    displayName: "HVAC — Repair",
  },
  {
    vertical: "roofing.residential",
    businessType: "residential roofing contractor in the UK",
    displayName: "Roofing — Residential",
  },
  // ── GENERAL_ custom verticals ─────────────────────────────────────────────
  {
    vertical: "GENERAL_FITNESS_PT",
    businessType: "personal trainer offering 1-to-1 and online fitness coaching in the UK",
    displayName: "Personal Trainer",
  },
  {
    vertical: "GENERAL_FITNESS_GYM",
    businessType: "independent gym or fitness studio in the UK",
    displayName: "Gym / Fitness Studio",
  },
  {
    vertical: "GENERAL_REAL_ESTATE_BUYER",
    businessType: "estate agent helping buyers find and purchase property in the UK",
    displayName: "Estate Agent — Buyer",
  },
  {
    vertical: "GENERAL_REAL_ESTATE_SELLER",
    businessType: "estate agent helping homeowners sell their property in the UK",
    displayName: "Estate Agent — Seller",
  },
  {
    vertical: "GENERAL_DENTAL_COSMETIC",
    businessType: "cosmetic dental practice offering veneers, composite bonding, and smile makeovers in the UK",
    displayName: "Cosmetic Dentistry",
  },
  {
    vertical: "GENERAL_DENTAL_GENERAL",
    businessType: "general dental practice accepting NHS and private patients in the UK",
    displayName: "General Dentistry",
  },
  {
    vertical: "GENERAL_BAKERY",
    businessType: "artisan bakery or cake shop in the UK",
    displayName: "Bakery",
  },
  {
    vertical: "GENERAL_PLUMBER",
    businessType: "plumbing and heating engineer for residential properties in the UK",
    displayName: "Plumber",
  },
  {
    vertical: "GENERAL_ACCOUNTANT",
    businessType: "chartered accountant offering tax returns, bookkeeping, and business accounts in the UK",
    displayName: "Accountant",
  },
  {
    vertical: "GENERAL_WEDDING_PHOTOGRAPHER",
    businessType: "wedding photographer in the UK",
    displayName: "Wedding Photographer",
  },
];

// ── GPT-4o Tool Schema ────────────────────────────────────────────────────────

const GENERATE_PROFILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "create_vertical_profile",
    description: "Create a complete vertical intelligence profile.",
    parameters: {
      type: "object",
      properties: {
        avgTransactionValueGbp: { type: "number" },
        purchaseTimelineDays: { type: "integer" },
        conversionGoalType: { type: "string", enum: ["formbooking", "phonecall", "walkin"] },
        cplBenchmarkGbp: { type: "number" },
        creativeStyle: { type: "string" },
        audienceNotes: { type: "string" },
        targetingRecommendations: { type: "string" },
        bidStrategyNotes: { type: "string" },
        offerStructure: { type: "string" },
        callScriptNotes: { type: "string" },
      },
      required: [
        "avgTransactionValueGbp",
        "purchaseTimelineDays",
        "conversionGoalType",
        "cplBenchmarkGbp",
        "creativeStyle",
        "audienceNotes",
        "targetingRecommendations",
        "bidStrategyNotes",
        "offerStructure",
        "callScriptNotes",
      ],
      additionalProperties: false,
    },
  },
};

// ── Seed Function ─────────────────────────────────────────────────────────────

interface GeneratedData {
  avgTransactionValueGbp: number;
  purchaseTimelineDays: number;
  conversionGoalType: string;
  cplBenchmarkGbp: number;
  creativeStyle: string;
  audienceNotes: string;
  targetingRecommendations: string;
  bidStrategyNotes: string;
  offerStructure: string;
  callScriptNotes: string;
}

async function generateProfile(target: SeedTarget): Promise<GeneratedData> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an expert media buyer with 15 years of performance marketing experience. " +
          "Generate a complete vertical intelligence profile for the following business type. " +
          "Base all CPL benchmarks on real UK market data. " +
          "All recommendations must be specific and actionable.",
      },
      {
        role: "user",
        content: `Business type: ${target.businessType}\nVertical: ${target.displayName}`,
      },
    ],
    tools: [GENERATE_PROFILE_TOOL],
    tool_choice: { type: "function", function: { name: "create_vertical_profile" } },
    temperature: 0.3,
    max_tokens: 1200,
  });

  const rawToolCall = response.choices[0]?.message?.tool_calls?.[0];
  const toolCall = rawToolCall as ChatCompletionMessageFunctionToolCall | undefined;
  if (!toolCall?.function?.arguments) {
    throw new Error(`No tool call returned for ${target.vertical}`);
  }

  return JSON.parse(toolCall.function.arguments) as GeneratedData;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌱 Aurum Vertical Intelligence Library — Seed Script`);
  console.log(`   Seeding ${SEED_TARGETS.length} vertical profiles...\n`);

  let seeded = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < SEED_TARGETS.length; i++) {
    const target = SEED_TARGETS[i]!;
    const prefix = `[${String(i + 1).padStart(2, "0")}/${SEED_TARGETS.length}]`;

    try {
      // Check if already exists
      const existing = await prisma.verticalProfile.findUnique({
        where: { vertical: target.vertical },
      });

      if (existing) {
        console.log(`${prefix} ⏭  SKIP  ${target.displayName} (already exists)`);
        skipped++;
        continue;
      }

      // Generate via GPT-4o
      process.stdout.write(`${prefix} ⏳ GEN   ${target.displayName}...`);
      const generated = await generateProfile(target);
      const cplBenchmarkUsd = Math.round(generated.cplBenchmarkGbp * GBP_TO_USD_RATE * 100) / 100;

      // Save to DB
      await prisma.verticalProfile.create({
        data: {
          vertical: target.vertical,
          displayName: target.displayName,
          avgTransactionValueGbp: generated.avgTransactionValueGbp,
          purchaseTimelineDays: generated.purchaseTimelineDays,
          conversionGoalType: generated.conversionGoalType,
          cplBenchmarkGbp: generated.cplBenchmarkGbp,
          cplBenchmarkUsd,
          creativeStyle: generated.creativeStyle,
          audienceNotes: generated.audienceNotes,
          targetingRecommendations: generated.targetingRecommendations,
          bidStrategyNotes: generated.bidStrategyNotes,
          offerStructure: generated.offerStructure,
          callScriptNotes: generated.callScriptNotes,
          performanceData: {},
        },
      });

      process.stdout.write(` ✅ CPL £${generated.cplBenchmarkGbp}\n`);
      seeded++;

      // 500ms delay between GPT calls to avoid rate limiting
      if (i < SEED_TARGETS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(` ❌ FAIL\n`);
      console.error(`       Error: ${msg}`);
      errors.push(`${target.vertical}: ${msg}`);
      failed++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ Seeded:  ${seeded}`);
  console.log(`⏭  Skipped: ${skipped}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`${"─".repeat(50)}\n`);

  if (errors.length > 0) {
    console.log("Failed verticals:");
    errors.forEach((e) => console.log(`  • ${e}`));
    console.log();
  }

  // Exit with error if more than 3 profiles failed
  if (failed > 3) {
    console.error("Too many failures. Exiting with code 1.");
    process.exit(1);
  }

  console.log("Seed complete. 🎉\n");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
