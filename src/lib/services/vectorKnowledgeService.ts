/**
 * src/lib/services/vectorKnowledgeService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Cross-tenant vector knowledge graph (Sprint 10F) — the compound-intelligence
 * moat. When a creative wins big for one client, we extract the PSYCHOLOGICAL
 * PATTERN (not the words), embed it, and store it anonymised by vertical. Every
 * night each client's vertical patterns are adapted to that client's own offer.
 *
 * The `embedding vector(1536)` column lives in pgvector and is read/written via
 * raw SQL ($executeRaw / $queryRaw) — Prisma has no native vector type. Embeddings
 * use OpenAI text-embedding-3-small. NEVER THROWS.
 */

import OpenAI from "openai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = "text-embedding-3-small";

/** Embeds text → 1536-dim vector. Returns null if unavailable. NEVER THROWS. */
async function embed(text: string): Promise<number[] | null> {
  try {
    if (!process.env.OPENAI_API_KEY) return null;
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input: text });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[vectorKnowledge] embed failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** pgvector literal: "[0.1,0.2,...]". */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export interface ExtractInput {
  vertical:     string;
  psychPattern: string;   // plain-English psychological framework (PII-stripped)
  cplReduction: number;   // % CPL reduction that triggered extraction
  sourceCity?:  string;   // anonymised
}

/**
 * Stores a winning psychological pattern with its embedding. Deduplicates against
 * existing patterns in the same vertical via cosine distance (<0.15 ≈ duplicate),
 * bumping the existing row's deployedCount instead of inserting. NEVER THROWS.
 */
export async function extractAndStorePattern(input: ExtractInput): Promise<{ stored: boolean; deduped: boolean }> {
  try {
    const vec = await embed(input.psychPattern);
    if (!vec) {
      // No embedding — still record the pattern (without vector) so it's usable.
      await prisma.vectorKnowledge.create({
        data: { vertical: input.vertical, psychPattern: input.psychPattern, cplReduction: input.cplReduction, sourceCity: input.sourceCity ?? null },
      });
      return { stored: true, deduped: false };
    }

    const lit = toVectorLiteral(vec);
    // Nearest existing pattern in the same vertical.
    const near = await prisma.$queryRaw<Array<{ id: string; distance: number }>>(Prisma.sql`
      SELECT id, embedding <=> ${lit}::vector AS distance
      FROM "VectorKnowledge"
      WHERE vertical = ${input.vertical} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT 1
    `);

    if (near[0] && near[0].distance < 0.15) {
      await prisma.vectorKnowledge.update({ where: { id: near[0].id }, data: { deployedCount: { increment: 1 } } });
      return { stored: false, deduped: true };
    }

    // Insert with the embedding (raw — Prisma can't set a vector column).
    const id = `vk_${Date.now().toString(36)}${Math.round(vec[0] ? vec[0] * 1e6 : 0).toString(36)}`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "VectorKnowledge" (id, vertical, "psychPattern", embedding, "cplReduction", "sourceCity")
      VALUES (${id}, ${input.vertical}, ${input.psychPattern}, ${lit}::vector, ${input.cplReduction}, ${input.sourceCity ?? null})
    `);
    return { stored: true, deduped: false };
  } catch (err) {
    console.error("[vectorKnowledge] extractAndStorePattern failed:", err instanceof Error ? err.message : err);
    return { stored: false, deduped: false };
  }
}

export interface KnowledgePattern {
  id: string; psychPattern: string; cplReduction: number; deployedCount: number;
}

/** Top winning patterns for a vertical (by CPL reduction). NEVER THROWS. */
export async function topPatternsForVertical(vertical: string, limit = 3): Promise<KnowledgePattern[]> {
  try {
    const rows = await prisma.vectorKnowledge.findMany({
      where:   { vertical },
      orderBy: [{ cplReduction: "desc" }, { createdAt: "desc" }],
      take:    limit,
      select:  { id: true, psychPattern: true, cplReduction: true, deployedCount: true },
    });
    return rows;
  } catch (err) {
    console.error("[vectorKnowledge] topPatternsForVertical failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Adapts the best vertical pattern to a specific client's offer + location, and
 * logs it to the client's creative queue (an AgentAction). NEVER THROWS.
 * Returns true if a pattern was adapted + logged.
 */
export async function adaptPatternsForClient(blueprintId: string, tenantId: string): Promise<boolean> {
  try {
    const blueprint = await prisma.campaignBlueprint.findFirst({
      where:  { id: blueprintId, tenantId },
      select: { businessName: true, vertical: true, targetLocation: true, offerHook: true },
    });
    if (!blueprint) return false;

    const patterns = await topPatternsForVertical(blueprint.vertical, 1);
    if (patterns.length === 0) return false;
    if (!process.env.OPENAI_API_KEY) return false;

    const top = patterns[0];
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", temperature: 0.6, max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You adapt a proven psychological ad framework (learned from the agency's network in this " +
            "vertical) to one specific client's offer and location. Output a concise creative brief (hook + " +
            "angle) the client's creative director can execute. No vendor names, no other client's specifics.",
        },
        {
          role: "user",
          content:
            `Vertical: ${blueprint.vertical}\nClient: ${blueprint.businessName}\nLocation: ${blueprint.targetLocation}\n` +
            `Offer: ${blueprint.offerHook ?? "(none set)"}\n\nWinning framework to adapt:\n${top.psychPattern}\n\n` +
            "Write the adapted creative brief now.",
        },
      ],
    });

    const brief = completion.choices[0]?.message?.content?.trim();
    if (!brief) return false;

    await prisma.agentAction.create({
      data: {
        tenantId, blueprintId, agentName: "Kai",
        actionType: "CREATIVE_PATTERN_ADOPTED",
        reasoning:  `Adopted a winning hook structure from the ${blueprint.vertical} network, adapted for ${blueprint.targetLocation}:\n${brief}`,
        outcome:    "Added to the creative queue",
      },
    });
    await prisma.vectorKnowledge.update({ where: { id: top.id }, data: { deployedCount: { increment: 1 } } }).catch(() => {});
    return true;
  } catch (err) {
    console.error(`[vectorKnowledge] adaptPatternsForClient failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
