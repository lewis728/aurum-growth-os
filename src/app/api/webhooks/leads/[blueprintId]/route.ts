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
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { triggerAutomations } from "@/lib/services/automationEngine";
import { createPhoneCall, toE164 } from "@/lib/services/retellService";
import { CampaignStatus } from "@/enums/campaignEnums";
import type { CRMLayer } from "@/types/crmLayer";

export const dynamic = "force-dynamic";

// ── Speed-to-lead outbound call ──────────────────────────────────────────────
// Places a Retell call within seconds of lead creation. Never throws — every
// outcome (placed / skipped / failed) is recorded as an AgentAction so the
// agency owner sees it in the feed. The webhook must still 200 regardless.

interface SpeedToLeadBlueprint {
  id:           string;
  tenantId:     string;
  status:       string;
  businessName: string;
  vertical:     string;
  offerHook:    string | null;
  voice:        unknown;
}

async function triggerSpeedToLeadCall(
  blueprint: SpeedToLeadBlueprint,
  lead: { id: string; firstName: string; lastName: string; phone: string }
): Promise<void> {
  const rep = await prisma.aIRepresentative.findUnique({
    where:  { blueprintId: blueprint.id },
    select: { repName: true },
  });
  const agentName = rep?.repName ?? "Sophie";

  const logAction = (actionType: string, reasoning: string, outcome: string) =>
    prisma.agentAction
      .create({ data: { tenantId: blueprint.tenantId, blueprintId: blueprint.id, agentName, actionType, reasoning, outcome } })
      .catch((e: unknown) => console.error("[leads webhook] AgentAction log failed:", e));

  try {
    const fromNumber = process.env.RETELL_FROM_NUMBER;
    const agentId =
      (blueprint.voice as { retellAgentId?: string } | null)?.retellAgentId ||
      process.env.RETELL_AGENT_ID;

    if (!fromNumber || !agentId) {
      await logAction(
        "CALL_FAILED",
        `Could not call ${lead.firstName} ${lead.lastName}: Retell is not configured (missing ${!fromNumber ? "from number" : "agent id"}).`,
        "Call skipped — Retell not configured"
      );
      return;
    }

    const toNumber = toE164(lead.phone);
    if (!toNumber) {
      await logAction(
        "CALL_FAILED",
        `Could not call ${lead.firstName} ${lead.lastName}: phone number "${lead.phone}" is not a valid number.`,
        "Call skipped — invalid phone number"
      );
      return;
    }

    const { callId } = await createPhoneCall({
      fromNumber,
      toNumber,
      agentId,
      dynamicVariables: {
        lead_first_name:     lead.firstName,
        business_name:       blueprint.businessName,
        vertical:            blueprint.vertical,
        agent_name:          agentName,
        service_description: blueprint.offerHook ?? "",
      },
    });

    await prisma.lead.update({ where: { id: lead.id }, data: { retellCallId: callId } });
    await logAction(
      "CALL_INITIATED",
      `Called ${lead.firstName} ${lead.lastName} within 60 seconds of form submission.`,
      "Call placed"
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[leads webhook] Retell call failed:", msg);
    await logAction(
      "CALL_FAILED",
      `Tried to call ${lead.firstName} ${lead.lastName} but the call could not be placed: ${msg}`,
      "Call failed"
    );
  }
}

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
        formData:    (payload.formData ?? {}) as object,
      },
      select: { id: true, firstName: true, lastName: true, phone: true, tenantId: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[leads webhook] DB error:", msg);
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 });
  }

  // ── Speed-to-lead: Sophie calls within 60 seconds ────────────────────────
  // Awaited (not fire-and-forget) so the call is guaranteed to be placed even
  // on serverless, where post-response work can be killed. Never throws.
  if (blueprint.status === CampaignStatus.LIVE) {
    await triggerSpeedToLeadCall(blueprint, lead);
  }

  // ── Trigger automations (fire-and-forget) ─────────────────────────────────
  setImmediate(() => {
    const crmLayer = blueprint.crm as unknown as CRMLayer;
    void triggerAutomations(
      { blueprintId: blueprint.id, leadId: lead.id, tenantId: lead.tenantId },
      crmLayer.automationTriggers ?? [],
      "lead.created"
    );
  });

  return NextResponse.json({ success: true, leadId: lead.id }, { status: 200 });
}
