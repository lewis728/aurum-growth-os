/**
 * src/app/api/admin/deploy-client/route.ts
 * POST /api/admin/deploy-client
 *
 * TEMPORARY admin utility to run the "Deploy Sophie" provisioning path
 * (provisionClientAgent) server-side for testing, without a Clerk session.
 * Runs on Vercel where RETELL_API_KEY / OPENAI_API_KEY / DATABASE_URL live.
 *
 * Auth: Bearer CRON_SECRET (same as the cron + set-blueprint-live routes).
 * tenantId is derived from the blueprint row so the caller only needs the id.
 *
 * Remove before opening to paying customers.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { provisionClientAgent } from "@/lib/services/agentProvisioning";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return Boolean(process.env.CRON_SECRET) && auth === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: { blueprintId?: string } = {};
  try {
    body = (await req.json()) as { blueprintId?: string };
  } catch {
    /* empty body ok */
  }

  const blueprintId = body.blueprintId;
  if (!blueprintId) {
    return NextResponse.json({ error: "blueprintId required" }, { status: 400 });
  }

  const blueprint = await prisma.campaignBlueprint.findFirst({
    where:  { id: blueprintId },
    select: { id: true, tenantId: true },
  });
  if (!blueprint) {
    return NextResponse.json({ error: "blueprint not found" }, { status: 404 });
  }

  try {
    const result = await provisionClientAgent(blueprintId, blueprint.tenantId);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "provisioning failed";
    console.error("[admin/deploy-client] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
