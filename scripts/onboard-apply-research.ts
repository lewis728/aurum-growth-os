/**
 * scripts/onboard-apply-research.ts  (onboard-client skill — applies deep research)
 *
 * Takes the JSON result of the `deep-client-research` workflow and writes the deep
 * fields onto an existing client's ClientBrief (what Marcus reads via clientContext)
 * + the blueprint's mediaBuying (for the ad build):
 *   - winningStrategy, mediaBuyerPlaybook  → ClientBrief (surfaced to Marcus + Sophie)
 *   - localCplBenchmark, competitorSnapshot, geoIntelligence, competitorNames → ClientBrief
 *   - researchTargeting → blueprint.mediaBuying (for the Meta ad build)
 *
 * NEVER fabricates — only writes what the research produced. Idempotent (re-runnable).
 * Run: npm run onboard:apply -- --blueprint <id> --research <path-to-workflow-output.json>
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const n = argv[i + 1]; if (n && !n.startsWith("--")) { opts[k] = n; i++; } }
  }
  return opts;
}

interface CompetitorSnapshot { count?: number; notable?: string[] }
interface Synthesis {
  winningStrategy?: string;
  mediaBuyerPlaybook?: string;
  targeting?: Record<string, unknown>;
  localCplBenchmarkGbp?: number;
  competitorSnapshot?: CompetitorSnapshot;
  marketSummary?: string;
}
interface Market { demandDrivers?: string[]; seasonality?: string; homeownerIntent?: string[] }
interface ResearchResult { synthesis?: Synthesis; market?: Market }

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const blueprintId = opts.blueprint?.trim();
  if (!blueprintId) { console.error("ERROR: --blueprint <id> is required"); process.exit(1); }
  if (!opts.research) { console.error("ERROR: --research <path-to-json> is required"); process.exit(1); }

  const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), opts.research), "utf8")) as Record<string, unknown>;
  // The workflow output wraps the return value in `result`; accept either shape.
  const result = ((raw.result as ResearchResult) ?? (raw as unknown as ResearchResult)) ?? {};
  const s: Synthesis = result.synthesis ?? {};
  const m: Market = result.market ?? {};

  if (!s.winningStrategy && !s.mediaBuyerPlaybook) {
    console.error("ERROR: no synthesis.winningStrategy/mediaBuyerPlaybook in the research file."); process.exit(1);
  }

  const geoIntelligence = {
    marketSummary:  s.marketSummary ?? null,
    seasonality:    m.seasonality ?? null,
    demandDrivers:  m.demandDrivers ?? [],
    homeownerIntent: m.homeownerIntent ?? [],
    capturedAt:     new Date().toISOString(),
  };
  const competitorNames = (s.competitorSnapshot?.notable ?? []).map((n) => n.split("—")[0]?.trim() || n).filter(Boolean).join("; ");

  const bp = await prisma.campaignBlueprint.findUnique({ where: { id: blueprintId }, select: { id: true, mediaBuying: true } });
  if (!bp) { console.error(`ERROR: blueprint ${blueprintId} not found`); process.exit(1); }

  await prisma.clientBrief.update({
    where: { blueprintId },
    data: {
      winningStrategy:    s.winningStrategy ?? undefined,
      mediaBuyerPlaybook: s.mediaBuyerPlaybook ?? undefined,
      localCplBenchmark:  typeof s.localCplBenchmarkGbp === "number" ? s.localCplBenchmarkGbp : undefined,
      competitorSnapshot: s.competitorSnapshot ? (s.competitorSnapshot as unknown as Prisma.InputJsonValue) : undefined,
      geoIntelligence:    geoIntelligence as unknown as Prisma.InputJsonValue,
      competitorNames:    competitorNames || undefined,
    },
  });

  if (s.targeting) {
    const mb = (bp.mediaBuying && typeof bp.mediaBuying === "object" ? bp.mediaBuying : {}) as Record<string, unknown>;
    await prisma.campaignBlueprint.update({
      where: { id: blueprintId },
      data: { mediaBuying: { ...mb, researchTargeting: s.targeting } as unknown as Prisma.InputJsonValue },
    });
  }

  console.log(JSON.stringify({
    ok: true, blueprintId,
    applied: {
      winningStrategy: Boolean(s.winningStrategy),
      mediaBuyerPlaybook: Boolean(s.mediaBuyerPlaybook),
      localCplBenchmark: s.localCplBenchmarkGbp ?? null,
      competitors: s.competitorSnapshot?.count ?? 0,
      researchTargeting: Boolean(s.targeting),
    },
    note: "Marcus now reads winningStrategy + mediaBuyerPlaybook via buildClientContext on every cycle.",
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("onboard:apply FAILED:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
