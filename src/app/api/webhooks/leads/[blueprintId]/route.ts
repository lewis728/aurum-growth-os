/**
 * src/app/api/webhooks/leads/[blueprintId]/route.ts
 * POST /api/webhooks/leads/:blueprintId
 * PUBLIC — No Clerk auth required. Called by deployed landing pages.
 *
 * - Validates HMAC signature via x-aurum-signature header (sha256=)
 * - Creates a Lead row and triggers automations
 * - NEVER throws — all errors return appropriate HTTP status
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { triggerAutomations } from "@/lib/services/automationEngine";
import { computeLeadScore } from "@/lib/services/speedToLeadService";
import { callLead } from "@/lib/agents/roles/caller";
import { enrichLead } from "@/lib/services/leadEnrichmentService";
import type { CRMLayer } from "@/types/crmLayer";

export const dynamic = "force-dynamic";

// ── Null guard — fail fast at module load if secret is missing ────────────────
const secret = process.env.LEAD_WEBHOOK_SECRET;
if (!secret) throw new Error("LEAD_WEBHOOK_SECRET is not set");

// ── HMAC validation ───────────────────────────────────────────────────────────

function validateLeadSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  // secret is guaranteed non-null by the module-level null guard above
  const expected    = `sha256=${crypto.createHmac("sha256", secret!).update(rawBody, "utf8").digest("hex")}`;
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

// ── Payload schema ────────────────────────────────────────────────────────────

const LeadPayloadSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
  fullName:  z.string().min(1).optional(),
  phone:     z.string().min(7).max(20),
  email:     z.string().email().optional(),
  formData:  z.record(z.string(), z.unknown()).optional(),
});

function parseFullName(payload: z.infer<typeof LeadPayloadSchema>): { firstName: string; lastName: string } {
  if (payload.firstName && payload.lastName) {
    return { firstName: payload.firstName, lastName: payload.lastName };
  }
  if (payload.fullName) {
    const parts     = payload.fullName.trim().split(/\s+/);
    const firstName = parts[0] ?? "Unknown";
    const lastName  = parts.slice(1).join(" ") || "Unknown";
    return { firstName, lastName };
  }
  return { firstName: "Unknown", lastName: "Unknown" };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<NextResponse> {
  const { blueprintId } = params;

  // ── Signature validation (before any DB access) ───────────────────────────
  const rawBody   = await req.text();
  const signature = req.headers.get("x-aurum-signature");
  if (!validateLeadSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── Blueprint lookup ──────────────────────────────────────────────────────
  const blueprint = await prisma.campaignBlueprint.findUnique({
    where:  { id: blueprintId },
    select: {
      id: true, tenantId: true, crm: true,
      status: true, businessName: true, vertical: true, offerHook: true, voice: true,
    },
  });
  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  // ── Parse body from rawBody string (not req.json()) ──────────────────────
  let payload: z.infer<typeof LeadPayloadSchema>;
  try {
    const raw = JSON.parse(rawBody) as unknown;
    payload = LeadPayloadSchema.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid lead payload" }, { status: 400 });
  }

  const { firstName, lastName } = parseFullName(payload);

  // ── Lead intent score (Sprint 11) ─────────────────────────────────────────
  const leadScore = computeLeadScore({ at: new Date(), formData: payload.formData ?? null });

  // ── Create lead ───────────────────────────────────────────────────────────
  let lead: { id: string; firstName: string; lastName: string; phone: string; tenantId: string };
  try {
    lead = await prisma.lead.create({
      data: {
        blueprintId: blueprint.id,
        tenantId:    blueprint.tenantId,
        firstName,
        lastName,
        phone:       payload.phone,
        email:       payload.email,
        status:      "new",
        leadScore,
        formData:    (payload.formData ?? {}) as object,
      },
      select: { id: true, firstName: true, lastName: true, phone: true, tenantId: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[leads webhook] DB error:", msg);
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 });
  }

  // ── Lead fingerprinting (Sprint 10D) ─────────────────────────────────────
  // Enrich + tier the lead BEFORE the call so Sophie's script adapts (premium →
  // exclusivity frame, never discounts). Fast on the local-only path; never throws.
  await enrichLead(lead.id, lead.tenantId);

  // ── Speed-to-lead: Sophie calls within 60 seconds ────────────────────────
  // Awaited (not fire-and-forget) so the call is guaranteed to be placed even
  // on serverless, where post-response work can be killed. Never throws; the
  // service skips non-LIVE blueprints internally.
  await callLead({
    blueprintId: blueprint.id,
    tenantId:    blueprint.tenantId,
    lead,
  });

  // ── Trigger automations — AWAITED ─────────────────────────────────────────
  // Must NOT be deferred (setImmediate): on Vercel serverless the function is
  // frozen once the response returns, so deferred work silently never runs.
  // Wrapped so a failing automation never blocks the 200 (the lead + call are
  // already persisted).
  try {
    const crmLayer = blueprint.crm as unknown as CRMLayer;
    await triggerAutomations(
      { blueprintId: blueprint.id, leadId: lead.id, tenantId: lead.tenantId },
      crmLayer.automationTriggers ?? [],
      "lead.created"
    );
  } catch (err) {
    console.error("[leads webhook] triggerAutomations failed:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ success: true, leadId: lead.id }, { status: 200 });
}
