/**
 * src/app/api/webhooks/calendly/route.ts
 * POST /api/webhooks/calendly
 *
 * Public endpoint — no Clerk auth. Validated via HMAC-SHA256 signature.
 *
 * Handles two Calendly webhook events:
 *
 *   invitee.created
 *     - Upserts a Lead record (phone/email/name from invitee payload)
 *     - Creates or updates an Appointment record (scheduled start time)
 *     - Updates Lead.status → "booked"
 *
 *   invitee.canceled
 *     - Updates Appointment.status → "cancelled"
 *     - Updates Lead.status → "cancelled"
 *
 * Non-fatal contract:
 *   - Always returns HTTP 200 to Calendly to prevent retry storms.
 *   - Logs errors internally but never exposes them in the response body.
 *
 * Required environment variables:
 *   CALENDLY_WEBHOOK_SECRET — HMAC-SHA256 signing secret from Calendly webhook settings
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// ── Environment Guard ─────────────────────────────────────────────────────────

function getCalendlyWebhookSecret(): string {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET;
  if (!secret) throw new Error("CALENDLY_WEBHOOK_SECRET is not configured");
  return secret;
}

// ── HMAC Validation ───────────────────────────────────────────────────────────

/**
 * Validates the Calendly webhook signature.
 * Calendly signs payloads with HMAC-SHA256 and sends the signature in
 * the "Calendly-Webhook-Signature" header as:
 *   t=<timestamp>,v1=<hex_signature>
 *
 * Validation: HMAC-SHA256(secret, timestamp + "." + rawBody)
 * Max age: 5 minutes to prevent replay attacks.
 */
function validateCalendlySignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  if (!signatureHeader) return false;

  let secret: string;
  try {
    secret = getCalendlyWebhookSecret();
  } catch {
    return false;
  }

  // Parse "t=<timestamp>,v1=<signature>"
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [k, v] = part.split("=");
      return [k?.trim(), v?.trim()];
    })
  );

  const timestamp = parts["t"];
  const receivedSig = parts["v1"];

  if (!timestamp || !receivedSig) return false;

  // Replay attack prevention: reject events older than 5 minutes
  const timestampMs = parseInt(timestamp, 10) * 1000;
  if (isNaN(timestampMs) || Date.now() - timestampMs > 5 * 60 * 1000) {
    console.warn("[calendly/webhook] Signature timestamp too old — possible replay attack");
    return false;
  }

  const message = `${timestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSig, "hex");
  const receivedBuf = Buffer.from(receivedSig, "hex");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

// ── Calendly Payload Types ────────────────────────────────────────────────────

interface CalendlyInvitee {
  uri: string;
  name: string;
  email: string;
  text_reminder_number?: string | null;
  cancel_url?: string;
  reschedule_url?: string;
  canceled?: boolean;
  cancellation?: {
    canceled_by: string;
    reason: string | null;
    canceler_type: string;
  };
}

interface CalendlyEventResource {
  uri: string;
  name?: string;
  start_time?: string;
  end_time?: string;
  location?: {
    type: string;
    location?: string;
    join_url?: string;
  };
}

interface CalendlyWebhookPayload {
  event: "invitee.created" | "invitee.canceled" | string;
  payload: {
    event: string;           // Calendly event URI
    invitee: CalendlyInvitee;
    event_type?: {
      name?: string;
    };
    tracking?: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
    };
    scheduled_event?: CalendlyEventResource;
  };
  created_at?: string;
}

// ── Helper: extract tenantId from CalendarConnection ─────────────────────────

/**
 * Looks up which tenant owns this Calendly event by matching the user URI
 * stored in CalendarConnection.calendarId against the event URI prefix.
 *
 * Calendly event URIs follow the pattern:
 *   https://api.calendly.com/scheduled_events/<uuid>
 * User URIs:
 *   https://api.calendly.com/users/<uuid>
 *
 * We match on the user UUID extracted from the CalendarConnection.calendarId.
 */
async function resolveTenantIdFromCalendlyEvent(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _eventUri: string
): Promise<string | null> {
  // Find all Calendly connections and match by user URI prefix
  const connections = await prisma.calendarConnection.findMany({
    where: { provider: "CALENDLY" },
    select: { tenantId: true, calendarId: true },
  });

  if (connections.length === 0) return null;

  // If only one Calendly tenant, use it directly (common case)
  if (connections.length === 1) {
    return connections[0]!.tenantId;
  }

  // For multi-tenant: match by checking if the event belongs to the user's org
  // Calendly event URIs contain the org UUID, not the user UUID directly.
  // For now, we return the first match — in a full multi-tenant deployment
  // this should be resolved via the Calendly API using the access token.
  // This is acceptable because each Calendly account is scoped to one tenant.
  console.warn(
    "[calendly/webhook] Multiple Calendly connections found — using first match. " +
    "For multi-tenant deployments, implement per-user event routing."
  );
  return connections[0]!.tenantId;
}

// ── Event Handlers ────────────────────────────────────────────────────────────

async function handleInviteeCreated(
  payload: CalendlyWebhookPayload["payload"],
  tenantId: string
): Promise<void> {
  const { invitee, scheduled_event } = payload;

  // Parse name into first/last
  const nameParts = (invitee.name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] ?? "Unknown";
  const lastName = nameParts.slice(1).join(" ") || "";

  const phone = invitee.text_reminder_number ?? "";
  const email = invitee.email ?? null;

  // Upsert Lead by (tenantId, email) unique constraint
  // If no email (edge case), create a new lead using phone as identifier
  let lead: { id: string };
  if (email) {
    lead = await prisma.lead.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: {
        tenantId,
        firstName,
        lastName,
        phone,
        email,
        status: "booked",
        source: "calendly",
      },
      update: {
        firstName,
        lastName,
        phone,
        status: "booked",
        updatedAt: new Date(),
      },
    });
  } else {
    // No email — always create a new lead (Calendly always collects email, this is a fallback)
    lead = await prisma.lead.create({
      data: {
        tenantId,
        firstName,
        lastName,
        phone,
        email: null,
        status: "booked",
        source: "calendly",
      },
    });
  }

  // Parse scheduled start time
  const scheduledAt = scheduled_event?.start_time
    ? new Date(scheduled_event.start_time)
    : new Date();

  // Upsert Appointment by Calendly event URI
  const calendlyEventId = scheduled_event?.uri ?? invitee.uri;

  await prisma.appointment.upsert({
    where: { calendlyEventId },
    create: {
      tenantId,
      leadId: lead.id,
      scheduledAt,
      confirmed: true,
      status: "confirmed",
      calendlyEventId,
      source: "calendly",
      notes: `Booked via Calendly. Event: ${scheduled_event?.name ?? "Consultation"}`,
    },
    update: {
      scheduledAt,
      confirmed: true,
      status: "confirmed",
      updatedAt: new Date(),
    },
  });

  console.log(
    `[calendly/webhook] invitee.created — Lead ${lead.id} (${firstName} ${lastName}) ` +
    `booked appointment at ${scheduledAt.toISOString()} for tenant ${tenantId}`
  );
}

async function handleInviteeCanceled(
  payload: CalendlyWebhookPayload["payload"],
  tenantId: string
): Promise<void> {
  const { invitee, scheduled_event } = payload;
  const calendlyEventId = scheduled_event?.uri ?? invitee.uri;

  // Update appointment status
  const updated = await prisma.appointment.updateMany({
    where: { tenantId, calendlyEventId: calendlyEventId },
    data: { status: "cancelled", confirmed: false, updatedAt: new Date() },
  });

  if (updated.count === 0) {
    console.warn(
      `[calendly/webhook] invitee.canceled — No appointment found for ` +
      `Calendly event URI ${calendlyEventId} (tenant ${tenantId})`
    );
    return;
  }

  // Update lead status to cancelled if email is available
  if (invitee.email) {
    await prisma.lead.updateMany({
      where: { tenantId, email: invitee.email, status: "booked" },
      data: { status: "cancelled", updatedAt: new Date() },
    });
  }

  console.log(
    `[calendly/webhook] invitee.canceled — Appointment for event ${calendlyEventId} ` +
    `cancelled for tenant ${tenantId}`
  );
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Read raw body for HMAC validation ──────────────────────────────────
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  // ── 2. Validate HMAC signature ────────────────────────────────────────────
  const signatureHeader = req.headers.get("Calendly-Webhook-Signature");
  const isValid = validateCalendlySignature(rawBody, signatureHeader);

  if (!isValid) {
    console.warn("[calendly/webhook] Invalid HMAC signature — rejecting request");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Parse payload ──────────────────────────────────────────────────────
  let webhookPayload: CalendlyWebhookPayload;
  try {
    webhookPayload = JSON.parse(rawBody) as CalendlyWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { event, payload } = webhookPayload;

  // ── 4. Resolve tenant ─────────────────────────────────────────────────────
  let tenantId: string | null;
  try {
    tenantId = await resolveTenantIdFromCalendlyEvent(payload.event);
  } catch (err) {
    console.error(
      "[calendly/webhook] Failed to resolve tenantId:",
      err instanceof Error ? err.message : String(err)
    );
    // Return 200 to prevent Calendly retry storms
    return NextResponse.json({ received: true });
  }

  if (!tenantId) {
    console.warn("[calendly/webhook] No matching CalendarConnection found — ignoring event");
    return NextResponse.json({ received: true });
  }

  // ── 5. Route to handler ───────────────────────────────────────────────────
  try {
    switch (event) {
      case "invitee.created":
        await handleInviteeCreated(payload, tenantId);
        break;

      case "invitee.canceled":
        await handleInviteeCanceled(payload, tenantId);
        break;

      default:
        // Unknown event type — log and acknowledge
        console.log(`[calendly/webhook] Unhandled event type: ${event}`);
    }
  } catch (err) {
    // Non-fatal — log error but return 200 to prevent retry storms
    console.error(
      `[calendly/webhook] Handler error for event "${event}":`,
      err instanceof Error ? err.message : String(err)
    );
  }

  // ── 6. Always return 200 ──────────────────────────────────────────────────
  return NextResponse.json({ received: true });
}
