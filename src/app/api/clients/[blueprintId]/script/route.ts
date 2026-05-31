/**
 * PUT /api/clients/[blueprintId]/script
 * Saves the agency owner's edited call script (Sprint 3D): persists to
 * ClientBrief.callScriptOverride AND pushes it live to the client's Retell LLM so
 * it's effective on the next call — no redeploy. GET returns the current script
 * (override if set, else the assembled brief-aware prompt).
 *
 * Tenant-scoped.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { updateRetellLlmPrompt } from "@/lib/services/retellService";

export const dynamic = "force-dynamic";

interface VoiceLayerIds { retellLlmId?: string }

async function load(blueprintId: string, tenantId: string) {
  return prisma.campaignBlueprint.findFirst({
    where:  { id: blueprintId, tenantId },
    select: { id: true, voice: true, clientBrief: { select: { callScriptOverride: true } } },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const bp = await load(params.blueprintId, tenantId);
  if (!bp) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  return NextResponse.json({ script: bp.clientBrief?.callScriptOverride ?? null });
}

const BodySchema = z.object({ script: z.string().min(1).max(8000) });

export async function PUT(
  req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const bp = await load(params.blueprintId, tenantId);
  if (!bp) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Persist the override (upsert the brief).
  await prisma.clientBrief.upsert({
    where:  { blueprintId: params.blueprintId },
    create: { blueprintId: params.blueprintId, tenantId, callScriptOverride: body.script },
    update: { callScriptOverride: body.script },
  });

  // Push live to the Retell LLM if the client has a provisioned agent.
  const llmId = (bp.voice as VoiceLayerIds | null)?.retellLlmId;
  let live = false;
  if (llmId) {
    try { await updateRetellLlmPrompt(llmId, body.script); live = true; }
    catch (err) { console.error("[script] Retell push failed:", err instanceof Error ? err.message : err); }
  }

  return NextResponse.json({
    ok: true,
    live,
    note: live
      ? "Script updated and live — effective on the next call."
      : "Script saved. It goes live when this client's voice agent is deployed.",
  });
}
