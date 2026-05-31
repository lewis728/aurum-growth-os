// src/app/api/representative/deploy/route.ts
// POST /api/representative/deploy
//
// The "Deploy Sophie" action. Provisions (or re-deploys) a dedicated Retell voice
// agent for a single client, built from that client's brief, and sets the
// blueprint LIVE so new leads are called within 60 seconds.
//
// Idempotent: calling it again updates the existing agent's prompt in place
// rather than creating a duplicate.

import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { auth }                       from "@clerk/nextjs/server";
import { provisionClientAgent }       from "@/lib/services/agentProvisioning";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  blueprintId: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // TEMP: subscription mandate gate disabled for solo test env —
  // restore before opening to paying customers (see docs/STATUS.md §9).

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse((await req.json()) as unknown);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // ── Provision ─────────────────────────────────────────────────────────────
  try {
    const result = await provisionClientAgent(body.blueprintId, tenantId);
    return NextResponse.json(
      {
        deployed: true,
        agentId:  result.agentId,
        created:  result.created, // true = new agent, false = updated existing
      },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Provisioning failed";
    console.error("[deploy] provisionClientAgent failed:", msg);
    // 404 for not-found / tenant errors, 502 for upstream (Retell) failures.
    const isNotFound = /not found|does not belong|No representative/i.test(msg);
    return NextResponse.json({ error: msg }, { status: isNotFound ? 404 : 502 });
  }
}
