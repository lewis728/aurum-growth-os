/**
 * src/lib/orchestrator/funnelOrchestrator.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Executes the complete 7-step campaign launch sequence.
 * Coordinates every external API service and produces a live, active campaign.
 * Every step is atomic and logged. Any failure persists error state to DB before re-throwing.
 *
 * STEP 1 — Budget Guard & Stripe Mandate Validation
 * STEP 2 — Creative Generation (Higgsfield)
 * STEP 3 — Landing Page Deployment (Vercel)
 * STEP 4 — Voice Agent Update (Retell)
 * STEP 5 — Meta Campaign Creation
 * STEP 6 — Persist to Database
 * STEP 7 — Final Log & Return
 */

import { prisma } from "@/lib/prisma";
import { CampaignStatus } from "@/enums/campaignEnums";
import type { CampaignBlueprint, OrchestratorEvent } from "@/types/campaignBlueprint";

import { validateStripeMandate, addClientSeat } from "@/lib/services/stripeService";
import { generateCreative } from "@/lib/services/higgsFieldService";
import { deployLandingPage } from "@/lib/services/landingPageService";
import { assembleRetellPromptAsync } from "@/lib/services/retellPromptAssembler";
import { updateRetellAgent } from "@/lib/services/retellService";
import {
  createCampaign,
  createAdCreative,
  createAdSet,
  createAd,
} from "@/lib/services/metaAdsService";

// ── Types ─────────────────────────────────────────────────────────────────────

type BlueprintInput = Omit<CampaignBlueprint, "createdAt" | "updatedAt" | "orchestrationLog">;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function makeEvent(
  step: string,
  status: OrchestratorEvent["status"],
  message: string,
  durationMs: number,
  extras?: { error?: string; payload?: Record<string, unknown> }
): OrchestratorEvent {
  return {
    step,
    status,
    timestamp: nowIso(),
    durationMs,
    ...(extras?.error !== undefined ? { error: extras.error } : {}),
    ...(extras?.payload !== undefined ? { payload: extras.payload } : {}),
  };
}

/**
 * Persists the current blueprint state to the database.
 * Maps the TypeScript CampaignBlueprint contract to the Prisma schema columns.
 * Used for both intermediate error states and the final success state.
 */
async function persistBlueprint(
  blueprint: CampaignBlueprint,
  log: OrchestratorEvent[]
): Promise<void> {
  const geoLocations = blueprint.mediaBuyingLayer.targeting.geoLocations;
  const targetLocation =
    geoLocations.cities?.join(", ") ??
    geoLocations.regions?.join(", ") ??
    geoLocations.countries?.join(", ") ??
    "UK";

  await prisma.campaignBlueprint.upsert({
    where: { id: blueprint.blueprintId },
    create: {
      id:               blueprint.blueprintId,
      tenantId:         blueprint.tenantId,
      status:           blueprint.status,
      vertical:         blueprint.serviceIntent,
      businessName:     blueprint.voiceLayer.promptInjections.tenantName,
      targetLocation,
      dailyBudgetUsd:   blueprint.budget.dailyUsd,
      creative:         blueprint.creativeLayer as object,
      mediaBuying:      blueprint.mediaBuyingLayer as object,
      deployment:       blueprint.deploymentLayer as object,
      voice:            blueprint.voiceLayer as object,
      crm:              blueprint.crmLayer as object,
      orchestrationLog: log as object[],
    },
    update: {
      status:           blueprint.status,
      creative:         blueprint.creativeLayer as object,
      mediaBuying:      blueprint.mediaBuyingLayer as object,
      deployment:       blueprint.deploymentLayer as object,
      voice:            blueprint.voiceLayer as object,
      crm:              blueprint.crmLayer as object,
      orchestrationLog: log as object[],
      updatedAt:        new Date(),
    },
  });
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

/**
 * Executes the complete 7-step campaign launch sequence.
 *
 * @param input    - CampaignBlueprint without lifecycle timestamps or orchestrationLog
 * @param tenantId - Clerk organisation ID for this tenant
 * @returns        The fully populated CampaignBlueprint as saved to the database
 */
export async function funnelOrchestrator(
  input: BlueprintInput,
  tenantId: string
): Promise<CampaignBlueprint> {
  // Working copy — we mutate layers throughout the pipeline
  const blueprint: CampaignBlueprint = {
    ...input,
    tenantId,
    orchestrationLog: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const log: OrchestratorEvent[] = [];

  // ── STEP 1 — Budget Guard & Stripe Mandate Validation ────────────────────
  {
    const t0 = Date.now();
    try {
      if (blueprint.budget.dailyUsd < 10) {
        throw new Error(
          `Budget guard failed: dailyUsd (${blueprint.budget.dailyUsd}) is below the minimum of $10.`
        );
      }

      const mandateValid = await validateStripeMandate(tenantId);
      if (!mandateValid) {
        throw new Error(
          "No valid payment mandate. Client must add a payment method."
        );
      }

      log.push(makeEvent("MANDATE_VALIDATED", "success", "Stripe mandate confirmed", Date.now() - t0));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(makeEvent("MANDATE_VALIDATED", "failure", msg, Date.now() - t0, { error: msg }));
      blueprint.status = CampaignStatus.FAILED;
      await persistBlueprint(blueprint, log);
      throw err;
    }
  }

  // ── STEP 2 — Creative Generation ────────────────────────────────────────────
  // Branch on creative.mode:
  //   'upload'   → BYO-Creative: use the first uploaded asset URL, skip Higgsfield entirely
  //   'generate' → Higgsfield flow (default)
  {
    const t0 = Date.now();
    const creativeMode = blueprint.creativeLayer.mode ?? "generate";

    if (creativeMode === "upload") {
      // ── BYO-Creative path ────────────────────────────────────────────────────
      const uploadedAssets = blueprint.creativeLayer.uploadedAssets ?? [];
      const firstAsset = uploadedAssets[0];

      if (!firstAsset) {
        const msg = "BYO-Creative mode selected but no uploaded assets found on blueprint.";
        log.push(makeEvent("CREATIVE_READY", "failure", msg, Date.now() - t0, { error: msg }));
        blueprint.status = CampaignStatus.FAILED;
        await persistBlueprint(blueprint, log);
        throw new Error(msg);
      }

      // Set primaryAssetId to the uploaded asset URL so downstream Meta steps can use it
      blueprint.creativeLayer = {
        ...blueprint.creativeLayer,
        primaryAssetId: firstAsset.assetUrl,
        generatedAt: nowIso(),
      };

      log.push(
        makeEvent("CREATIVE_READY", "success", "Client creative asset loaded — using uploaded creative", Date.now() - t0, {
          payload: { mode: "upload", assetUrl: firstAsset.assetUrl, fileName: firstAsset.fileName },
        })
      );
    } else {
      // ── Higgsfield generate path ─────────────────────────────────────────────
      try {
        const asset = await generateCreative(blueprint.creativeLayer.serviceContext, undefined);

        blueprint.creativeLayer = {
          ...blueprint.creativeLayer,
          assets: [...blueprint.creativeLayer.assets, asset],
          primaryAssetId: asset.assetId,
          generatedAt: nowIso(),
        };

        log.push(
          makeEvent("CREATIVE_GENERATED", "success", "Creative asset ready", Date.now() - t0, {
            payload: { assetUrl: asset.url, assetId: asset.assetId },
          })
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.push(makeEvent("CREATIVE_GENERATED", "failure", msg, Date.now() - t0, { error: msg }));
        blueprint.status = CampaignStatus.FAILED;
        await persistBlueprint(blueprint, log);
        throw err;
      }
    }
  }

  // ── STEP 3 — Landing Page Deployment (Vercel) ─────────────────────────────
  {
    const t0 = Date.now();
    try {
      const deployedPage = await deployLandingPage(blueprint);

      blueprint.deploymentLayer = {
        ...blueprint.deploymentLayer,
        deployedUrl:        deployedPage.liveUrl,
        vercelDeploymentId: deployedPage.deploymentId,
        deployedAt:         nowIso(),
      };

      // Inject live URL into media buying layer so Meta ad points to the real page
      blueprint.mediaBuyingLayer = {
        ...blueprint.mediaBuyingLayer,
        landingPageUrl: deployedPage.liveUrl,
      };

      log.push(
        makeEvent("LANDING_PAGE_DEPLOYED", "success", "Landing page live", Date.now() - t0, {
          payload: { liveUrl: deployedPage.liveUrl, deploymentId: deployedPage.deploymentId },
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(makeEvent("LANDING_PAGE_DEPLOYED", "failure", msg, Date.now() - t0, { error: msg }));
      blueprint.status = CampaignStatus.FAILED;
      await persistBlueprint(blueprint, log);
      throw err;
    }
  }

  // ── STEP 4 — Voice Agent Update ─────────────────────────────────────────────
  // Fetches the AIRepresentative config (if configured) and assembles the full
  // voice agent system prompt. Marks lastDeployedAt on the representative row.
  {
    const t0 = Date.now();
    try {
      // Fetch AIRepresentative config for this blueprint (may be null on first launch)
      const representative = await prisma.aIRepresentative.findUnique({
        where: { blueprintId: blueprint.blueprintId },
      });

      const assembledPrompt = await assembleRetellPromptAsync(
        blueprint as Parameters<typeof assembleRetellPromptAsync>[0],
        representative
      );

      blueprint.voiceLayer = {
        ...blueprint.voiceLayer,
        assembledPrompt,
      };

      await updateRetellAgent(blueprint.voiceLayer.retellAgentId, assembledPrompt);

      // Mark representative as deployed if one exists
      if (representative) {
        await prisma.aIRepresentative.update({
          where: { blueprintId: blueprint.blueprintId },
          data:  { lastDeployedAt: new Date() },
        });
      }

      log.push(
        makeEvent("VOICE_AGENT_CONFIGURED", "success", "AI representative deployed", Date.now() - t0, {
          payload: {
            agentId:         blueprint.voiceLayer.retellAgentId,
            repName:         representative?.repName ?? "default",
            personality:     representative?.personality ?? "PROFESSIONAL",
          },
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(makeEvent("VOICE_AGENT_CONFIGURED", "failure", msg, Date.now() - t0, { error: msg }));
      blueprint.status = CampaignStatus.FAILED;
      await persistBlueprint(blueprint, log);
      throw err;
    }
  }

  // ── STEP 5 — Meta Campaign Creation ───────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      const campaignId  = await createCampaign(blueprint, tenantId);
      const creativeId  = await createAdCreative(blueprint, tenantId);
      const adSetId     = await createAdSet(blueprint, campaignId, tenantId);
      const adId        = await createAd(blueprint, adSetId, creativeId, tenantId);

      blueprint.mediaBuyingLayer = {
        ...blueprint.mediaBuyingLayer,
        metaAdIds: {
          campaignId,
          adSetId,
          adId,
          adCreativeId: creativeId,
        },
      };

      log.push(
        makeEvent("META_CAMPAIGN_ACTIVE", "success", "Campaign live on Meta", Date.now() - t0, {
          payload: { campaignId, adSetId, adId, adCreativeId: creativeId },
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(makeEvent("META_CAMPAIGN_ACTIVE", "failure", msg, Date.now() - t0, { error: msg }));
      blueprint.status = CampaignStatus.FAILED;
      await persistBlueprint(blueprint, log);
      throw err;
    }
  }

  // ── STEP 6 — Persist to Database ──────────────────────────────────────────
  {
    const t0 = Date.now();
    try {
      blueprint.status    = CampaignStatus.LIVE;
      blueprint.liveAt    = nowIso();
      blueprint.updatedAt = nowIso();

            log.push(makeEvent("BLUEPRINT_PERSISTED", "success", "Campaign blueprint saved", Date.now() - t0));
      await persistBlueprint(blueprint, log);
      // Fire-and-forget: notify Stripe of new client seat. Billing failure must never block campaign launch.
      addClientSeat(tenantId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[funnelOrchestrator] addClientSeat failed for tenantId=${tenantId}: ${msg}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(makeEvent("BLUEPRINT_PERSISTED", "failure", msg, Date.now() - t0, { error: msg }));
      blueprint.status = CampaignStatus.FAILED;
      try {
        await persistBlueprint(blueprint, log);
      } catch {
        // Best-effort error persist — do not mask the original error
      }
      throw err;
    }
  }

  // ── STEP 7 — Final Log & Return ───────────────────────────────────────────
  {
    const t0 = Date.now();
    log.push(
      makeEvent(
        "ORCHESTRATION_COMPLETE",
        "success",
        "Campaign fully launched and active",
        Date.now() - t0
      )
    );

    blueprint.orchestrationLog = log;
    blueprint.updatedAt = nowIso();

    // Update the DB record with the complete orchestrationLog
    await prisma.campaignBlueprint.update({
      where: { id: blueprint.blueprintId },
      data: {
        orchestrationLog: log as object[],
        updatedAt:        new Date(),
      },
    });
  }

  return blueprint;
}
