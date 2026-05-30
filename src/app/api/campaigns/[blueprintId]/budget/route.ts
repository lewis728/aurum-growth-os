/**
 * src/app/api/campaigns/[blueprintId]/budget/route.ts
 * PATCH /api/campaigns/[blueprintId]/budget
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Allows an agency owner to update a client campaign's daily Meta ad budget
 * directly from the Aurum dashboard — no Meta Ads Manager required.
 *
 * Business rules:
 *  - Minimum £10/day (enforced server-side independently of client)
 *  - 20% rule: if new > current * 1.20, return a warning (unless force: true)
 *  - GBP → USD conversion via GBPUSD_RATE env var (default 1.27)
 *  - Ownership check: tenant A cannot update tenant B's campaign
 *
 * Response shapes:
 *  200 { warning: '20_PERCENT_RULE', safeIncrease, requestedIncrease, message }
 *  200 { blueprint: CampaignBlueprint, message: string }
 *  400 { error: string }
 *  401 { error: string }
 *  403 { error: string }
 *  404 { error: string }
 *  502 { error: string }
 */
import { auth } from "@clerk/nextjs/server";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { updateCampaignBudget } from "@/lib/services/metaAdsService";
import { getSubscriptionStatus } from "@/lib/services/stripeService";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── GBP → USD conversion ──────────────────────────────────────────────────────

const GBPUSD_RATE = parseFloat(process.env.GBPUSD_RATE ?? "1.27");

function gbpToUsd(gbp: number): number {
  return gbp * GBPUSD_RATE;
}

// ── Request body schema ───────────────────────────────────────────────────────

const BodySchema = z.object({
  dailyBudgetGbp: z
    .number()
    .min(10, "Client daily budget must be at least £10/day"),
  force: z.boolean().optional().default(false),
});

// ── Orchestration log entry type ──────────────────────────────────────────────

interface BudgetLogEntry {
  step: "BUDGET_UPDATED";
  status: "ok";
  message: string;
  timestamp: string;
  meta: {
    previousDailyBudgetGbp: number;
    newDailyBudgetGbp: number;
    previousDailyBudgetUsd: number;
    newDailyBudgetUsd: number;
    gbpusdRate: number;
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const { blueprintId } = params;

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = (await req.json()) as unknown;
    const result = BodySchema.safeParse(raw);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "Invalid request body";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    body = result.data;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { dailyBudgetGbp, force } = body;

  // ── 3. Ownership check ─────────────────────────────────────────────────────
  // CampaignBlueprint PK is `id` (cuid), not `blueprintId`
  const blueprint = await prisma.campaignBlueprint.findFirst({
    where: { id: blueprintId, tenantId },
  });

  if (!blueprint) {
    // Either doesn't exist or belongs to a different tenant — return 404 in both cases
    return NextResponse.json(
      { error: "Campaign not found or you do not have permission to update it" },
      { status: 404 }
    );
  }

  // ── 4. Subscription check ──────────────────────────────────────────────────
  try {
    const sub = await getSubscriptionStatus(tenantId);
    if (
      sub !== null &&
      (sub.status === "past_due" || sub.status === "canceled")
    ) {
      return NextResponse.json(
        {
          error:
            "Your payment method requires attention before adjusting client budgets. " +
            "Please update your billing details.",
        },
        { status: 403 }
      );
    }
  } catch {
    // Non-fatal — proceed if billing check fails (e.g. no subscription yet on trial)
  }

  // ── 5. Current budget ──────────────────────────────────────────────────────
  // dailyBudgetUsd is a Float column on the model
  const currentDailyUsd = blueprint.dailyBudgetUsd;
  const currentDailyGbp = currentDailyUsd > 0 ? currentDailyUsd / GBPUSD_RATE : 0;

  // ── 6. 20% rule check ──────────────────────────────────────────────────────
  const twentyPercentThreshold = currentDailyGbp * 1.2;

  if (currentDailyGbp > 0 && dailyBudgetGbp > twentyPercentThreshold && !force) {
    const safeIncrease = Math.round(twentyPercentThreshold * 100) / 100;
    return NextResponse.json(
      {
        warning: "20_PERCENT_RULE",
        safeIncrease,
        requestedIncrease: dailyBudgetGbp,
        message:
          `Increasing your client's budget by more than 20% resets the Meta algorithm learning phase. ` +
          `I recommend setting your client's budget to £${safeIncrease.toFixed(2)} today and scaling further in 48 hours.`,
      },
      { status: 200 }
    );
  }

  // ── 7. Convert GBP → USD ───────────────────────────────────────────────────
  const newDailyUsd = gbpToUsd(dailyBudgetGbp);
  // Meta expects cents as integer
  const newDailyUsdCents = Math.round(newDailyUsd * 100);

  // ── 8. Call Meta API ───────────────────────────────────────────────────────
  // adSetId is stored in the mediaBuying JSON column
  const mediaBuyingJson = blueprint.mediaBuying as {
    adSetId?: string;
    [key: string]: unknown;
  } | null;

  const adSetId = mediaBuyingJson?.adSetId;

  if (adSetId) {
    try {
      await updateCampaignBudget(adSetId, newDailyUsdCents, tenantId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Meta API error";
      console.error("[budget] Meta updateCampaignBudget failed:", msg);
      return NextResponse.json(
        { error: `Failed to update client campaign budget on Meta: ${msg}` },
        { status: 502 }
      );
    }
  } else {
    // Blueprint exists but has not been deployed to Meta yet — update DB only
    console.warn(
      `[budget] No adSetId on blueprint ${blueprintId} — updating DB only`
    );
  }

  // ── 9. Build orchestration log entry ──────────────────────────────────────
  const logEntry: BudgetLogEntry = {
    step: "BUDGET_UPDATED",
    status: "ok",
    message: `Client daily budget updated to £${dailyBudgetGbp.toFixed(2)}`,
    timestamp: new Date().toISOString(),
    meta: {
      previousDailyBudgetGbp: Math.round(currentDailyGbp * 100) / 100,
      newDailyBudgetGbp: dailyBudgetGbp,
      previousDailyBudgetUsd: Math.round(currentDailyUsd * 100) / 100,
      newDailyBudgetUsd: Math.round(newDailyUsd * 100) / 100,
      gbpusdRate: GBPUSD_RATE,
    },
  };

  // Append to existing orchestrationLog array
  const existingLog = Array.isArray(blueprint.orchestrationLog)
    ? (blueprint.orchestrationLog as Prisma.JsonArray)
    : [];

  // ── 10. Update DB ──────────────────────────────────────────────────────────
  const updatedBlueprint = await prisma.campaignBlueprint.update({
    where: { id: blueprintId },
    data: {
      dailyBudgetUsd: newDailyUsd,
      orchestrationLog: [...existingLog, logEntry as unknown as Prisma.JsonValue],
      updatedAt: new Date(),
    },
  });

  return NextResponse.json(
    {
      blueprint: updatedBlueprint,
      message: `Client campaign budget updated to £${dailyBudgetGbp.toFixed(2)}/day`,
    },
    { status: 200 }
  );
}
