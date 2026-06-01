/**
 * src/lib/training/trainingRunner.ts  (Part 4 — orchestrator)
 * SERVER-SIDE SCRIPT. Runs the full adversarial training programme across all 6
 * priority verticals and both agents, then prints a scorecard and persists
 * TrainingResult rows.
 *
 *   npm run train            — full: 100 caller + 30 media-buyer scenarios / vertical
 *   npm run train:quick      — --quick: 5 scenarios / vertical (smoke test)
 *   npm run train:estimate   — --dry-run: cost estimate, ZERO API calls
 *
 * Concurrency capped at 3. Each scenario is independent — one failure never aborts
 * the run (Promise.allSettled semantics via a bounded pool).
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { prisma } from "@/lib/prisma"; // app singleton — Prisma 7 driver adapter configured
import { CALLER_PERSONAS, CAMPAIGN_SCENARIOS } from "./adversarialEngine";
import { trainCallerScenario } from "./callerTrainer";
import { trainMediaBuyerScenario } from "./mediaBuyerTrainer";

const VERTICALS = ["aesthetics", "cosmetic_dentistry", "roofing", "solar", "hvac", "home_improvement"];
// Concurrency is env-tunable. Default 1 because a low OpenAI tier (e.g. 30k TPM)
// gets 429-throttled at higher fan-out, which distorts scores. Raise via
// TRAIN_CONCURRENCY once on a higher tier.
const CONCURRENCY = Number(process.env.TRAIN_CONCURRENCY ?? 1);

// Full programme: 100 caller runs + 30 media-buyer runs per vertical = 780 total.
const FULL_CALLER_PER_VERTICAL = 100;
const FULL_MEDIA_PER_VERTICAL = 30;
const QUICK_PER_VERTICAL = 5;

// Token + cost model for the dry-run estimate (GPT-4o, rough but honest).
const COST_PER_CALLER_RUN = 0.12;   // ~12-turn sim + grade + up to 3 rewrites
const COST_PER_MEDIA_RUN  = 0.03;   // decide + grade
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const QUICK = args.includes("--quick");

interface Job { kind: "caller" | "media"; vertical: string; index: number; }

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  const callerN = QUICK ? QUICK_PER_VERTICAL : FULL_CALLER_PER_VERTICAL;
  const mediaN = QUICK ? QUICK_PER_VERTICAL : FULL_MEDIA_PER_VERTICAL;
  for (const v of VERTICALS) {
    for (let i = 0; i < callerN; i++) jobs.push({ kind: "caller", vertical: v, index: i });
    for (let i = 0; i < mediaN; i++) jobs.push({ kind: "media", vertical: v, index: i });
  }
  return jobs;
}

function estimate(): void {
  const callerN = QUICK ? QUICK_PER_VERTICAL : FULL_CALLER_PER_VERTICAL;
  const mediaN = QUICK ? QUICK_PER_VERTICAL : FULL_MEDIA_PER_VERTICAL;
  const callerRuns = callerN * VERTICALS.length;
  const mediaRuns = mediaN * VERTICALS.length;
  const cost = callerRuns * COST_PER_CALLER_RUN + mediaRuns * COST_PER_MEDIA_RUN;
  console.log(`\n💰 Training cost estimate (${QUICK ? "quick" : "full"})`);
  console.log(`${"─".repeat(48)}`);
  console.log(`  Verticals:            ${VERTICALS.length}`);
  console.log(`  Caller runs:          ${callerRuns}  (${callerN}/vertical × ~$${COST_PER_CALLER_RUN}/run)`);
  console.log(`  Media-buyer runs:     ${mediaRuns}  (${mediaN}/vertical × ~$${COST_PER_MEDIA_RUN}/run)`);
  console.log(`  Total scenarios:      ${callerRuns + mediaRuns}`);
  console.log(`  Estimated GPT-4o cost: ~$${cost.toFixed(2)} USD`);
  console.log(`  Concurrency:          ${CONCURRENCY}`);
  console.log(`${"─".repeat(48)}`);
  console.log(`  NOTE: estimate only — no API calls were made.\n`);
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { await worker(items[i]); } catch (e) { console.error("[runner] job failed:", e instanceof Error ? e.message : e); }
    }
  });
  await Promise.all(runners);
}

interface Tally { runs: number; sum: number; passed: number; }
const key = (role: string, vertical: string, scenario: string) => `${role}|${vertical}|${scenario}`;

async function main() {
  if (DRY_RUN) { estimate(); return; }
  if (!process.env.OPENAI_API_KEY) { console.error("ERROR: OPENAI_API_KEY not set."); process.exit(1); }
  const jobs = buildJobs();
  console.log(`\n🥊 Adversarial training — ${jobs.length} scenarios across ${VERTICALS.length} verticals (${QUICK ? "quick" : "full"})\n`);

  const tallies = new Map<string, Tally>();
  const bump = (k: string, score: number, passed: boolean) => {
    const t = tallies.get(k) ?? { runs: 0, sum: 0, passed: 0 };
    t.runs++; t.sum += score; if (passed) t.passed++;
    tallies.set(k, t);
  };
  let done = 0;

  await runPool(jobs, async (job) => {
    if (job.kind === "caller") {
      const persona = CALLER_PERSONAS[job.index % CALLER_PERSONAS.length];
      const profile = await prisma.verticalProfile.findUnique({ where: { vertical: job.vertical }, select: { callScriptNotes: true, expertBrief: true } }).catch(() => null);
      const baseScript = profile?.callScriptNotes || profile?.expertBrief?.slice(0, 1500) ||
        `Open warmly, confirm you're speaking to the owner, reference why you're calling, qualify the need, handle objections, and book a specific date and time.`;
      const r = await trainCallerScenario({ vertical: job.vertical, persona, baseScript, seed: job.index + 1 });
      bump(key("caller", job.vertical, persona.key), r.score, r.passed);
      await prisma.trainingResult.create({ data: {
        agentRole: "caller", vertical: job.vertical, scenarioType: persona.key,
        overallScore: r.score, breakdown: r.breakdown, weaknesses: r.weaknesses, improvements: r.improvements, passed: r.passed,
      } }).catch(() => {});
      // Persist a refined script back to the vertical when self-heal improved it.
      if (r.refinedScript && r.passed) {
        await prisma.verticalProfile.update({ where: { vertical: job.vertical }, data: { callScriptNotes: r.refinedScript } }).catch(() => {});
      }
    } else {
      const scenario = CAMPAIGN_SCENARIOS[job.index % CAMPAIGN_SCENARIOS.length];
      const r = await trainMediaBuyerScenario({ vertical: job.vertical, scenario, seed: job.index + 1 });
      bump(key("mediaBuyer", job.vertical, scenario.key), r.score, r.passed);
      await prisma.trainingResult.create({ data: {
        agentRole: "mediaBuyer", vertical: job.vertical, scenarioType: scenario.key,
        overallScore: r.score, breakdown: r.breakdown, weaknesses: r.weaknesses, improvements: r.improvements, passed: r.passed,
      } }).catch(() => {});
    }
    done++;
    if (done % 10 === 0 || done === jobs.length) process.stdout.write(`\r  progress: ${done}/${jobs.length}`);
  }, CONCURRENCY);

  // ── Scorecard ───────────────────────────────────────────────────────────────
  console.log(`\n\n📊 SCORECARD\n${"─".repeat(64)}`);
  const byRoleVertical = new Map<string, Tally>();
  for (const [k, t] of Array.from(tallies.entries())) {
    const [role, vertical] = k.split("|");
    const rk = `${role}|${vertical}`;
    const agg = byRoleVertical.get(rk) ?? { runs: 0, sum: 0, passed: 0 };
    agg.runs += t.runs; agg.sum += t.sum; agg.passed += t.passed;
    byRoleVertical.set(rk, agg);
  }
  for (const [k, t] of Array.from(byRoleVertical.entries()).sort()) {
    const [role, vertical] = k.split("|");
    const avg = t.runs ? (t.sum / t.runs).toFixed(0) : "0";
    const passPct = t.runs ? ((t.passed / t.runs) * 100).toFixed(0) : "0";
    console.log(`  ${role.padEnd(11)} ${vertical.padEnd(20)} avg ${String(avg).padStart(3)}/100  pass ${passPct}%  (${t.runs} runs)`);
  }
  console.log(`${"─".repeat(64)}\n`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
