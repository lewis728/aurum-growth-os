/**
 * POST /api/webhooks/pos/[blueprintId]
 * Receives a transaction event from a client's POS (Zenoti/Phorest/Mindbody/manual),
 * matches it to a lead by email, updates LTV, and fires Meta CAPI (Sprint 10E).
 *
 * Auth: an HMAC signature over the raw body using the blueprint's posApiKey
 * (decrypted). This keeps the public endpoint tenant-scoped without Clerk. If no
 * posApiKey is configured, a shared CRON_SECRET bearer is accepted (manual setup).
 * Always returns 200 to the POS so it doesn't retry-storm; the body reports detail.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/services/metaAuthService";
import { recordPosTransaction, type PosEvent } from "@/lib/services/posIntegrationService";

export const dynamic = "force-dynamic";

function valid(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const rawBody = await req.text();

  const blueprint = await prisma.campaignBlueprint.findUnique({
    where:  { id: params.blueprintId },
    select: { id: true, tenantId: true, posApiKey: true },
  });
  if (!blueprint) return NextResponse.json({ ok: false, error: "unknown blueprint" }, { status: 404 });

  // ── Auth: HMAC over body with the blueprint POS key, else CRON_SECRET bearer ──
  let authorised = false;
  if (blueprint.posApiKey) {
    let key: string | null = null;
    try { key = decryptToken(blueprint.posApiKey); } catch { key = null; }
    if (key) authorised = valid(rawBody, req.headers.get("x-pos-signature"), key);
  }
  if (!authorised) {
    const cron = process.env.CRON_SECRET;
    authorised = Boolean(cron) && req.headers.get("authorization") === `Bearer ${cron}`;
  }
  if (!authorised) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // ── Parse + validate event ────────────────────────────────────────────────
  let payload: Partial<PosEvent>;
  try {
    payload = JSON.parse(rawBody) as Partial<PosEvent>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!payload.patientEmail || typeof payload.transactionValue !== "number" || payload.transactionValue < 0) {
    return NextResponse.json({ ok: false, error: "patientEmail and non-negative transactionValue required" }, { status: 400 });
  }

  const result = await recordPosTransaction(blueprint.id, blueprint.tenantId, {
    patientEmail:     payload.patientEmail,
    transactionValue: payload.transactionValue,
    treatmentType:    payload.treatmentType,
    date:             payload.date,
  });

  // Always 200 — the POS shouldn't retry-storm; detail is in the body.
  return NextResponse.json({ ok: true, ...result });
}
