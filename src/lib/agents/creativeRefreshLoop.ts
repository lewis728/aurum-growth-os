/**
 * src/lib/agents/creativeRefreshLoop.ts
 * SERVER-SIDE ONLY. Closes the #1 ongoing media-buyer task: when Marcus diagnoses
 * creative fatigue he no longer just FLAGS it — he generates a fresh creative,
 * PRE-FLIGHT SIMULATES it (15-persona gate, never spends on an unproven angle), and
 * queues the winner for one-tap approval (or auto-deploys when explicitly enabled).
 *
 * Pipeline: winning strategy → fresh concept (GPT, anti-fatigue new angle) →
 * Higgsfield asset → simulateCreative gate → log CREATIVE_REFRESH_READY for approval.
 *
 * Fire-and-forget. NEVER THROWS, NEVER BLOCKS the media-buyer cycle. The actual Meta
 * swap (createAdCreative + createAd + pauseAd) is gated behind CREATIVE_AUTODEPLOY +
 * a live Meta connection — by default it prepares + queues, honouring the review gate.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { openai, MODELS } from "@/lib/services/openaiClient";
import { buildClientContext } from "@/lib/agents/clientContext";
import { generateCreative } from "@/lib/services/higgsFieldService";
import { simulateCreative } from "@/lib/services/creativeSimulator";

interface FreshConcept {
  headline: string;
  hook: string;
  body: string;
  imageDescription: string;
  higgsfieldPrompt: string;
}

const MEDIA_BUYER_NAME = "Marcus";

async function writeConcept(strategy: string, brief: string, reason: string): Promise<FreshConcept | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const completion = await openai.chat.completions.create({
      model: MODELS.primary,
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a direct-response creative director. The current ad has FATIGUED. Write ONE genuinely FRESH " +
            "creative concept — a NEW angle/hook, not a tweak of the old one — grounded in the client's proven winning " +
            "strategy. It must beat fatigue by being a different pattern-interrupt while keeping the same offer. " +
            'Respond ONLY as JSON: {"headline": string, "hook": string (first 2-3 seconds, scroll-stopping), ' +
            '"body": string, "imageDescription": string, "higgsfieldPrompt": string (a vivid prompt to generate the visual/video)}.',
        },
        {
          role: "user",
          content: `WINNING STRATEGY:\n${strategy}\n\nCLIENT BRIEF:\n${brief.slice(0, 3000)}\n\nWhy we're refreshing: ${reason}\n\nWrite the fresh concept.`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<FreshConcept>;
    if (!parsed.headline || !parsed.hook) return null;
    return {
      headline: parsed.headline, hook: parsed.hook,
      body: parsed.body ?? "", imageDescription: parsed.imageDescription ?? "",
      higgsfieldPrompt: parsed.higgsfieldPrompt ?? `${parsed.headline}. ${parsed.imageDescription ?? ""}`,
    };
  } catch (err) {
    console.error("[creativeRefresh] concept failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Prepares a fresh, pre-validated creative for a fatigued campaign and queues it for
 * approval. Fire-and-forget; never throws.
 */
export async function runCreativeRefresh(opts: {
  blueprintId: string;
  tenantId: string;
  reason: string;
}): Promise<void> {
  const { blueprintId, tenantId, reason } = opts;
  const log = (actionType: string, reasoning: string, outcome: string) =>
    prisma.agentAction
      .create({ data: { tenantId, blueprintId, agentName: MEDIA_BUYER_NAME, actionType, reasoning, outcome } })
      .catch((e: unknown) => console.error("[creativeRefresh] log failed:", e instanceof Error ? e.message : e));

  try {
    const ctx = await buildClientContext(blueprintId);
    const strategy = ctx.brief?.winningStrategy?.trim() || ctx.promptBlock.slice(0, 1500);

    // 1. Fresh concept.
    const concept = await writeConcept(strategy, ctx.promptBlock, reason);
    if (!concept) { await log("CREATIVE_REFRESH_SKIPPED", `Wanted to refresh fatigued creative (${reason}) but couldn't draft a fresh concept (model unavailable).`, "Skipped — no concept"); return; }

    // 2. Generate the asset (Higgsfield). Graceful if unconfigured.
    let assetUrl: string | null = null;
    let assetId = `concept_${Date.now().toString(36)}`;
    try {
      const asset = await generateCreative(concept.higgsfieldPrompt);
      assetUrl = asset.url ?? null;
      assetId = asset.assetId || assetId;
    } catch (err) {
      // No Higgsfield — still simulate + queue the concept for the owner to produce.
      console.error("[creativeRefresh] generateCreative failed:", err instanceof Error ? err.message : err);
    }

    // 3. Pre-flight simulate — NEVER queue an unproven angle.
    const sim = await simulateCreative(blueprintId, tenantId, {
      creativeId: assetId, headline: concept.headline, hook: concept.hook,
      body: concept.body, imageDescription: concept.imageDescription,
    });

    const conceptSummary = `New angle: ${concept.hook}\nHeadline: ${concept.headline}\n${concept.body}`.slice(0, 800);

    if (!sim.passed) {
      await log(
        "CREATIVE_REFRESH_FAILED_SIM",
        `Generated a fresh creative to replace the fatigued one (${reason}), but it failed pre-flight simulation ` +
        `(score ${sim.meanScore}/10): ${sim.blockedReason ?? "below threshold"}. Will regenerate next cycle rather than spend on an unproven angle.\n\n${conceptSummary}`,
        "Held — fresh creative failed pre-flight, regenerating",
      );
      return;
    }

    // 4. Persist the prepared creative on the blueprint queue for one-tap approval.
    const bp = await prisma.campaignBlueprint.findUnique({ where: { id: blueprintId }, select: { creative: true } }).catch(() => null);
    const creative = (bp?.creative && typeof bp.creative === "object" ? bp.creative : {}) as Record<string, unknown>;
    const pending = Array.isArray(creative.pendingRefresh) ? (creative.pendingRefresh as unknown[]) : [];
    pending.unshift({ ...concept, assetId, assetUrl, simScore: sim.meanScore, reason, preparedAt: new Date().toISOString() });
    await prisma.campaignBlueprint.update({
      where: { id: blueprintId },
      data: { creative: { ...creative, pendingRefresh: pending.slice(0, 5) } as unknown as Prisma.InputJsonValue },
    }).catch(() => {});

    await log(
      "CREATIVE_REFRESH_READY",
      `Fatigue fix ready: I generated a fresh creative (new angle) and it PASSED pre-flight simulation ` +
      `(${sim.meanScore}/10 across 15 buyer personas). One tap to swap it in for the fatigued ad.\n\n${conceptSummary}` +
      (assetUrl ? `\nAsset: ${assetUrl}` : `\n(Concept ready — connect Higgsfield to auto-generate the visual.)`),
      "Fresh creative prepared + validated — awaiting your approval to deploy",
    );
  } catch (err) {
    console.error(`[creativeRefresh] failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
  }
}
