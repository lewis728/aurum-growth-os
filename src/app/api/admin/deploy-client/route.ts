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
import { getRetellLlmPrompt } from "@/lib/services/retellService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return Boolean(process.env.CRON_SECRET) && auth === expected;
}

/**
 * GET /api/admin/deploy-client?blueprintId=...
 * Reads back the LIVE prompt the provisioned agent is running on Retell, so we can
 * confirm it's the GPT-generated, brief-specific script. Bearer CRON_SECRET.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const blueprintId = req.nextUrl.searchParams.get("blueprintId");
  if (!blueprintId) {
    return NextResponse.json({ error: "blueprintId required" }, { status: 400 });
  }
  const bp = await prisma.campaignBlueprint.findFirst({
    where:  { id: blueprintId },
    select: { voice: true },
  });
  const voice = (bp?.voice ?? {}) as { retellLlmId?: string; retellAgentId?: string };
  if (!voice.retellLlmId) {
    return NextResponse.json({ error: "no retellLlmId on blueprint" }, { status: 404 });
  }
  const prompt = await getRetellLlmPrompt(voice.retellLlmId);
  return NextResponse.json(
    {
      ok: true,
      retellAgentId: voice.retellAgentId,
      retellLlmId:   voice.retellLlmId,
      promptLength:  prompt?.length ?? 0,
      prompt,
    },
    { status: 200 },
  );
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
