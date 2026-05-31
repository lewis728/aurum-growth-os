/**
 * POST /api/outreach/batch-generate
 * The leverage step: runs the qualify → hook → sequence pipeline over a batch of
 * imported-but-pending prospects in one call. Takes { prospectIds?: string[],
 * limit?: number }. Defaults to the oldest `pending` prospects for the tenant.
 *
 * A/B subject rotation is applied across the batch (variantIndex = position % 3).
 * Bounded concurrency keeps OpenAI happy and the function within its window.
 * Tenant-scoped. Each prospect is processed independently (one failure ≠ batch fail).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { processProspect } from "@/lib/outreach/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // headroom: ~40 prospects × up to ~6 GPT calls each

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 40;       // keeps worst-case wall-clock inside maxDuration
const MAX_EXPLICIT_IDS = 100;
const CONCURRENCY = 4;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { prospectIds?: unknown; limit?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { body = {}; }

  const explicitIds = Array.isArray(body.prospectIds)
    ? body.prospectIds.filter((x): x is string => typeof x === "string").slice(0, MAX_EXPLICIT_IDS)
    : [];
  const limit = Math.min(MAX_LIMIT, Math.max(1, typeof body.limit === "number" ? body.limit : DEFAULT_LIMIT));

  const targets = explicitIds.length
    ? await prisma.outreachProspect.findMany({ where: { tenantId, id: { in: explicitIds } }, select: { id: true } })
    : await prisma.outreachProspect.findMany({ where: { tenantId, status: "pending" }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, generated: 0, rejected: 0, errored: 0, failed: [] });
  }

  // Cumulative A/B rotation: offset the variant by how many prospects this tenant
  // has already generated, so a second batch doesn't repeat batch-one's variants.
  const priorGenerated = await prisma.outreachProspect
    .count({ where: { tenantId, customHook: { not: null } } })
    .catch(() => 0);

  let generated = 0, rejected = 0, errored = 0;
  const failed: { id: string; reason: string }[] = [];

  // Bounded-concurrency worker pool over the batch.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const idx = cursor++;
      const r = await processProspect({ prospectId: targets[idx].id, tenantId, variantIndex: (priorGenerated + idx) % 3 });
      if (r.status === "generated") generated++;
      else if (r.status === "rejected") rejected++;
      else { errored++; failed.push({ id: targets[idx].id, reason: r.reason ?? "error" }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  // ok is false when nothing generated or anything errored, so the UI can warn.
  return NextResponse.json({
    ok: errored === 0 && generated > 0,
    processed: targets.length, generated, rejected, errored,
    failed: failed.slice(0, 50),
  });
}
