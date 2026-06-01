/**
 * scripts/seed-decision-library.ts  (Task 1 — Case-Based Reasoning for Marcus)
 *
 * Seeds the CBR library: for each vertical in SEED_TEMPLATES, the hand-authored
 * 30-year-veteran base cases PLUS 10 GPT variations each, embedded with
 * text-embedding-3-small and stored in DecisionExample (pgvector). Idempotent —
 * re-running clears prior seed/generated rows per vertical (never touches
 * self_learned precedents Marcus has earned) and re-seeds.
 *
 * Run:  npm run seed:decisions
 * (run-batch.cjs forces Prisma onto DIRECT_URL session mode — the transaction
 *  pooler recycles connections during the long OpenAI waits in a batch run.)
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { prisma } from "../src/lib/prisma";
import { seedDecisionLibrary, type SeedReport } from "../src/lib/intelligence/decisionLibrary";

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY not set — cannot generate variations or embeddings.");
    process.exit(1);
  }

  console.log("Seeding the Marcus decision library (Case-Based Reasoning)…");
  console.log("Each base case → 10 GPT variations, embedded (1536-dim) into DecisionExample.\n");

  const started = Date.now();
  const report: SeedReport[] = await seedDecisionLibrary();
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  // Per-vertical table.
  const header = `${pad("VERTICAL", 22)}${padL("BASE", 6)}${padL("VARIATIONS", 12)}${padL("TOTAL", 8)}${padL("EMBEDDED", 10)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  let tBase = 0, tVar = 0, tTotal = 0, tEmb = 0;
  for (const r of report.sort((a, b) => a.vertical.localeCompare(b.vertical))) {
    console.log(
      `${pad(r.vertical, 22)}${padL(String(r.base), 6)}${padL(String(r.variations), 12)}${padL(String(r.total), 8)}${padL(String(r.embedded), 10)}`,
    );
    tBase += r.base; tVar += r.variations; tTotal += r.total; tEmb += r.embedded;
  }
  console.log("-".repeat(header.length));
  console.log(
    `${pad("TOTAL", 22)}${padL(String(tBase), 6)}${padL(String(tVar), 12)}${padL(String(tTotal), 8)}${padL(String(tEmb), 10)}`,
  );

  // Cross-check against the table.
  const dbCount = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT count(*)::int AS count FROM "DecisionExample"`,
  );
  const total = dbCount[0]?.count ?? 0;
  console.log(`\nDecisionExample rows in DB now: ${total}`);
  console.log(`Seeded ${tTotal} cases (${tEmb} retrievable with embeddings) across ${report.length} verticals in ${secs}s.`);

  if (tEmb === 0) {
    console.warn("\nWARNING: 0 rows got embeddings — CBR retrieval will return nothing. Check OPENAI_API_KEY / embedding model.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("seed:decisions FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
