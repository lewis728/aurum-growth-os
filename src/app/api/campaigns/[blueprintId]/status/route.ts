/**
 * src/app/api/campaigns/[blueprintId]/status/route.ts
 * PATCH /api/campaigns/[blueprintId]/status
 *
 * Pause or resume a CampaignBlueprint for the authenticated tenant.
 * Body: { action: "pause" | "resume" | "archive" }
 * Returns the updated blueprint row.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantId }               from "@/lib/auth";
import { prisma }                    from "@/lib/prisma";
import { CampaignStatus }            from "@/enums/campaignEnums";
import { removeClientSeat }          from "@/lib/services/stripeService";
import { z }                         from "zod";

const BodySchema = z.object({
  action: z.enum(["pause", "resume", "archive"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Validate body ───────────────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json() as unknown;
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const blueprintId = params.blueprintId;

  // ── Ownership check ─────────────────────────────────────────────────────────
  const existing = await prisma.campaignBlueprint.findFirst({
    where: { id: blueprintId, tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // ── Guard: only LIVE campaigns can be paused; only PAUSED can be resumed ────
  if (body.action === "pause" && existing.status !== CampaignStatus.LIVE) {
    return NextResponse.json(
      { error: "Only live campaigns can be paused" },
      { status: 422 }
    );
  }
  if (body.action === "resume" && existing.status !== CampaignStatus.PAUSED) {
    return NextResponse.json(
      { error: "Only paused campaigns can be resumed" },
      { status: 422 }
    );
  }
  if (body.action === "archive" && existing.status === CampaignStatus.ARCHIVED) {
    return NextResponse.json(
      { error: "Campaign is already archived" },
      { status: 422 }
    );
  }

  // ── Update status ───────────────────────────────────────────────────────────
  let newStatus: CampaignStatus;
  if (body.action === "pause") {
    newStatus = CampaignStatus.PAUSED;
  } else if (body.action === "archive") {
    newStatus = CampaignStatus.ARCHIVED;
  } else {
    newStatus = CampaignStatus.LIVE;
  }

  try {
    const updated = await prisma.campaignBlueprint.update({
      where: { id: blueprintId },
      data:  { status: newStatus, updatedAt: new Date() },
    });

    // Remove a seat when a campaign is archived (non-fatal)
    if (body.action === "archive") {
      setImmediate(() => {
        removeClientSeat(tenantId).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[PATCH /api/campaigns/[blueprintId]/status] removeClientSeat failed for tenantId=${tenantId}: ${msg}`);
        });
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/campaigns/[blueprintId]/status] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
