/**
 * POST /api/outreach/push
 * The "1-click approve" step: pushes selected generated prospects into Instantly.
 * Takes { prospectIds: string[] } (or { all: true } to push every 'generated'
 * prospect). Only prospects with status 'generated', a custom hook, and a contact
 * email are eligible. On success the prospect moves to 'emailing' and stores its
 * Instantly lead id. Tenant-scoped.
 *
 * Deliverability throttling (daily caps, delay, warmup) is Instantly's job — we
 * just inject; Instantly drip-sends.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { dispatchProspects } from "@/lib/outreach/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { prospectIds?: unknown; all?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { body = {}; }

  const ids = Array.isArray(body.prospectIds) ? body.prospectIds.filter((x): x is string => typeof x === "string") : [];
  const pushAll = body.all === true;

  if (!pushAll && ids.length === 0) {
    return NextResponse.json({ error: "Provide prospectIds[] or { all: true }." }, { status: 400 });
  }

  // Shared dispatcher: suppression-checked, message-logged, Instantly inject.
  const r = await dispatchProspects({ tenantId, prospectIds: pushAll ? undefined : ids });

  if (r.notConfigured) {
    return NextResponse.json({
      ok: false, pushed: 0, notConfigured: true,
      error: "Instantly not configured (set INSTANTLY_API_KEY and INSTANTLY_CAMPAIGN_ID). Sequences are generated and ready to export.",
    }, { status: 200 });
  }

  return NextResponse.json({
    ok: r.pushed > 0,
    pushed: r.pushed, failed: r.failed, suppressed: r.suppressed, ineligible: r.ineligible,
  });
}
