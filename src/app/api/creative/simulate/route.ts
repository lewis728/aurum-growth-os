/**
 * POST /api/creative/simulate
 * Runs the pre-flight 15-persona creative simulation (Sprint 10C-B) for a creative
 * before it's deployed to Meta. Tenant-scoped. Returns the mean score, pass/block
 * verdict, and per-persona objections so the generator can revise a blocked angle.
 *
 * body: { blueprintId, creativeId, headline, hook, body?, imageDescription? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { simulateCreative } from "@/lib/services/creativeSimulator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  blueprintId:      z.string().min(1),
  creativeId:       z.string().min(1),
  headline:         z.string().min(1).max(500),
  hook:             z.string().min(1).max(1000),
  body:             z.string().max(4000).optional(),
  imageDescription: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Tenant-scoped ownership check.
  const blueprint = await prisma.campaignBlueprint.findFirst({
    where:  { id: body.blueprintId, tenantId },
    select: { id: true },
  });
  if (!blueprint) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const result = await simulateCreative(body.blueprintId, tenantId, {
    creativeId:       body.creativeId,
    headline:         body.headline,
    hook:             body.hook,
    body:             body.body,
    imageDescription: body.imageDescription,
  });

  return NextResponse.json(result);
}
