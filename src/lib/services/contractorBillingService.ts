/**
 * src/lib/services/contractorBillingService.ts
 * SERVER-SIDE ONLY. Never import inside a "use client" component.
 *
 * Round-robin, prepaid-block billing (see memory `business-model-pivot`).
 *   - LOCK-IN: a contractor pre-pays £1,200 (Stripe Checkout, card saved off-session)
 *     for 3 confirmed bookings. The webhook grants 3 credits.
 *   - ASSIGNMENT (at call placement): the next contractor in the city's ROUND-ROBIN
 *     (least-recently-assigned first) is picked; if they're at 0 credits their card is
 *     auto-charged another £1,200 (+3); if that fails they're skipped to the next.
 *   - PER BOOKING: a confirmed booking CONSUMES 1 credit (no per-booking Stripe call —
 *     the money moved at lock-in / recharge), writes the booking into THAT contractor's
 *     calendar, notifies both parties, and advances the round-robin pointer.
 *
 * Golden rules:
 *   - routeAndChargeBooking() NEVER THROWS — it runs inside the post-call path.
 *   - SurveyCharge.appointmentId @unique → a booking is settled at most once.
 *   - A booking is NEVER reversed — if a contractor has no credit and the top-up fails
 *     we keep the booking and alert (chase the card).
 *   - Recharge never double-charges (per-minute idempotency key) and never double-credits
 *     (credits are SET to the block size from ≤0, not blindly incremented).
 *   - Zero `any`, zero `@ts-ignore`.
 */

import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { sendAgencyAlert } from "@/lib/services/alertService";
import { createCalendarEvent } from "@/lib/services/calendarService";
import { sendDirectSMS } from "@/lib/services/twilioService";
import type { Contractor } from "@prisma/client";

// ─── Stripe client (same version pin as stripeService.ts) ───────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

/** Integer GBP → integer pence. */
function toPence(gbp: number): number {
  return Math.round(gbp) * 100;
}

/** Bookings a lock-in / recharge block buys = floor(lockInFee / pricePerSurvey). 1200/400 = 3. */
export function lockInCredits(contractor: Pick<Contractor, "lockInFeeGbp" | "pricePerSurveyGbp">): number {
  if (contractor.pricePerSurveyGbp <= 0) return 0;
  return Math.floor(contractor.lockInFeeGbp / contractor.pricePerSurveyGbp);
}

async function safeSms(to: string, body: string): Promise<void> {
  try {
    await sendDirectSMS(to, body);
  } catch (e) {
    console.error("[contractorBilling] SMS failed:", e instanceof Error ? e.message : e);
  }
}

// ─── ensureContractorCustomer ───────────────────────────────────────────────────

async function ensureContractorCustomer(contractor: Contractor): Promise<string> {
  if (contractor.stripeCustomerId) return contractor.stripeCustomerId;
  const stripe = getStripe();
  const customer = await stripe.customers.create(
    {
      email: contractor.email,
      name: `${contractor.name} (${contractor.city})`,
      metadata: { contractorId: contractor.id, tenantId: contractor.tenantId },
    },
    { idempotencyKey: `contractor-customer:${contractor.id}` },
  );
  await prisma.contractor.update({ where: { id: contractor.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// ─── startContractorLockIn (£1,200 = 3 bookings, saves the card) ─────────────────

export async function startContractorLockIn(
  contractorId: string,
  opts: { successUrl: string; cancelUrl: string },
): Promise<string> {
  const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
  if (!contractor) throw new Error(`Contractor ${contractorId} not found`);

  const stripe = getStripe();
  const customerId = await ensureContractorCustomer(contractor);
  const credits = lockInCredits(contractor);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: toPence(contractor.lockInFeeGbp),
          product_data: { name: `Roof-survey lock-in — ${credits} confirmed bookings (${contractor.city})` },
        },
      },
    ],
    payment_intent_data: {
      setup_future_usage: "off_session", // save the card for auto top-ups
      metadata: { contractorId, tenantId: contractor.tenantId, kind: "lockin" },
    },
    metadata: { contractorId, tenantId: contractor.tenantId, kind: "lockin" },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (!session.url) throw new Error("[contractorBilling] Stripe returned no Checkout session URL");
  return session.url;
}

// ─── ensureCreditOrRecharge ──────────────────────────────────────────────────────

export interface CreditResult {
  ok: boolean;
  credits: number;
  reason?: string;
}

/**
 * Guarantees the contractor has at least one booking credit. If they're at 0, their
 * saved card is auto-charged £lockInFeeGbp (£1,200) off-session for the next block of
 * credits. NEVER THROWS. Idempotent: a per-minute key stops a double-charge and credits
 * are SET (not incremented) from ≤0 so two concurrent recharges can't stack.
 */
export async function ensureCreditOrRecharge(contractorId: string): Promise<CreditResult> {
  const c = await prisma.contractor.findUnique({ where: { id: contractorId } });
  if (!c) return { ok: false, credits: 0, reason: "not_found" };
  if (c.prepaidCreditRemaining > 0) return { ok: true, credits: c.prepaidCreditRemaining };
  if (c.status !== "active") return { ok: false, credits: 0, reason: "inactive" };
  if (!c.stripeCustomerId || !c.stripePaymentMethodId) return { ok: false, credits: 0, reason: "no_saved_card" };

  const block = lockInCredits(c);
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: toPence(c.lockInFeeGbp),
        currency: "gbp",
        customer: c.stripeCustomerId,
        payment_method: c.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Auto top-up — ${block} roof-survey bookings (${c.city})`,
        metadata: { contractorId: c.id, tenantId: c.tenantId, kind: "recharge" },
      },
      { idempotencyKey: `recharge:${c.id}:${Math.floor(Date.now() / 60000)}` },
    );
    if (pi.status === "succeeded") {
      // SET to the block size only if still ≤ 0 — concurrent recharges can't stack.
      await prisma.contractor.updateMany({
        where: { id: c.id, prepaidCreditRemaining: { lte: 0 } },
        data: { prepaidCreditRemaining: block },
      });
      const fresh = await prisma.contractor.findUnique({ where: { id: c.id }, select: { prepaidCreditRemaining: true } });
      return { ok: true, credits: fresh?.prepaidCreditRemaining ?? block };
    }
    return { ok: false, credits: 0, reason: `payment_intent_status:${pi.status}` };
  } catch (e: unknown) {
    const reason =
      e instanceof Stripe.errors.StripeError ? (e.code ?? e.message) : e instanceof Error ? e.message : String(e);
    await sendAgencyAlert(c.tenantId, {
      agentName: "Aurum Billing",
      clientName: c.name,
      actionType: "PAYMENT_FAILED",
      issue: `Auto top-up of £${c.lockInFeeGbp} failed for ${c.name} (${c.city}) — ${reason}.`,
      recommended: "Their card needs fixing; they're skipped in the rotation until it clears.",
      blueprintId: null,
    });
    return { ok: false, credits: 0, reason };
  }
}

// ─── assignRoundRobinContractor ──────────────────────────────────────────────────

/**
 * Picks the next contractor in the city's round-robin (least-recently-assigned first)
 * who has — or can be topped up to — a usable credit. Does NOT consume the credit or
 * advance the pointer (that happens only on a CONFIRMED booking). Returns null if no
 * active contractor in the territory is creditable. NEVER THROWS.
 */
export async function assignRoundRobinContractor(
  tenantId: string,
  city: string | null,
  vertical: string | null,
): Promise<Contractor | null> {
  if (!city || !vertical) return null;
  try {
    const contractors = await prisma.contractor.findMany({
      where: { tenantId, status: "active", vertical, city: { equals: city, mode: "insensitive" } },
      orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    });
    for (const c of contractors) {
      const r = await ensureCreditOrRecharge(c.id);
      if (r.ok) return await prisma.contractor.findUnique({ where: { id: c.id } });
    }
    return null;
  } catch (e) {
    console.error("[contractorBilling] assignRoundRobinContractor failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── routeAndChargeBooking (post-call: consume credit + calendar + notify) ───────

export type ChargeOutcome = "credit_consumed" | "failed" | "skipped";
export interface ChargeResult {
  outcome: ChargeOutcome;
  reason?: string;
  contractorId?: string;
}

interface ApptForBooking {
  tenantId: string;
  blueprintId: string | null;
  scheduledAt: Date;
  blueprint: { businessName: string; targetLocation: string | null; vertical: string | null } | null;
  lead: { firstName: string; lastName: string; phone: string; formData: unknown; assignedContractorId: string | null };
}

function roofIssueFrom(formData: unknown): string {
  const fd = (formData ?? {}) as Record<string, unknown>;
  const v = fd["Roof Issue"] ?? fd["roof_issue"] ?? fd["roofIssue"] ?? fd["job"] ?? fd["issue"];
  return (typeof v === "string" && v.trim() ? v.trim() : "Roof survey").slice(0, 200);
}

async function notifyBooking(contractor: Contractor, appt: ApptForBooking): Promise<void> {
  const when = appt.scheduledAt.toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const company = contractor.companyName?.trim() || contractor.name;
  const lead = appt.lead;
  const homeowner = `${lead.firstName} ${lead.lastName}`.trim() || "the homeowner";
  // Roofer: the lead's contact details + the job.
  if (contractor.phone) {
    await safeSms(
      contractor.phone,
      `New roof survey booked: ${homeowner}, ${lead.phone}. Job: ${roofIssueFrom(lead.formData)}. Visit ${when}.`,
    );
  }
  // Homeowner: post-call confirmation naming the roofer/company.
  if (lead.phone) {
    await safeSms(
      lead.phone,
      `You're booked in — ${company} will carry out your roof survey on ${when}. They'll be in touch to confirm.`,
    );
  }
}

/**
 * Settle a confirmed booking: consume 1 credit from the contractor assigned at call
 * placement (top-up if needed), write the booking into THAT contractor's calendar,
 * notify both parties, and advance the round-robin pointer. NEVER THROWS.
 */
export async function routeAndChargeBooking(appointmentId: string): Promise<ChargeResult> {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        tenantId: true,
        blueprintId: true,
        scheduledAt: true,
        blueprint: { select: { businessName: true, targetLocation: true, vertical: true } },
        lead: { select: { firstName: true, lastName: true, phone: true, formData: true, assignedContractorId: true } },
        surveyCharge: { select: { status: true } },
      },
    });
    if (!appt) return { outcome: "skipped", reason: "appointment_not_found" };
    if (appt.surveyCharge?.status === "credit_consumed") return { outcome: "skipped", reason: "already_settled" };

    // Contractor assigned at call placement; fall back to a fresh round-robin pick.
    let contractorId = appt.lead?.assignedContractorId ?? null;
    if (!contractorId) {
      const c = await assignRoundRobinContractor(appt.tenantId, appt.blueprint?.targetLocation ?? null, appt.blueprint?.vertical ?? null);
      contractorId = c?.id ?? null;
    }
    if (!contractorId) {
      await createCalendarEvent(appointmentId).catch(() => {});
      await sendAgencyAlert(appt.tenantId, {
        agentName: "Aurum Routing",
        clientName: appt.blueprint?.targetLocation ?? "Unknown territory",
        actionType: "NO_CONTRACTOR",
        issue: `A survey booked but no contractor with credit is available in ${appt.blueprint?.targetLocation ?? "this city"}.`,
        recommended: "Add a contractor or fix a card so the rotation has someone to take it.",
        blueprintId: appt.blueprintId,
      });
      return { outcome: "skipped", reason: "no_contractor" };
    }

    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
    if (!contractor) return { outcome: "skipped", reason: "contractor_missing" };

    // Claim the ledger row (unique appointmentId — idempotent).
    try {
      await prisma.surveyCharge.create({
        data: {
          appointmentId,
          contractorId,
          tenantId: appt.tenantId,
          blueprintId: appt.blueprintId,
          amountGbp: contractor.pricePerSurveyGbp,
          kind: "credit",
          status: "pending",
        },
      });
    } catch {
      const existing = await prisma.surveyCharge.findUnique({ where: { appointmentId }, select: { status: true } });
      if (!existing) return { outcome: "failed", reason: "ledger_create_failed" };
      if (existing.status === "credit_consumed") return { outcome: "skipped", reason: "already_settled" };
    }

    // Consume 1 credit (atomic). If none, top up and retry once. Never reverse a booking.
    let consumed = await prisma.contractor.updateMany({
      where: { id: contractorId, prepaidCreditRemaining: { gt: 0 } },
      data: { prepaidCreditRemaining: { decrement: 1 } },
    });
    if (consumed.count !== 1) {
      const r = await ensureCreditOrRecharge(contractorId);
      if (r.ok) {
        consumed = await prisma.contractor.updateMany({
          where: { id: contractorId, prepaidCreditRemaining: { gt: 0 } },
          data: { prepaidCreditRemaining: { decrement: 1 } },
        });
      }
    }
    const paid = consumed.count === 1;

    await prisma.surveyCharge.update({
      where: { appointmentId },
      data: { status: paid ? "credit_consumed" : "failed", failureReason: paid ? null : "no_credit_and_recharge_failed" },
    });

    // Advance the round-robin pointer (this contractor just got a job).
    await prisma.contractor.update({ where: { id: contractorId }, data: { lastAssignedAt: new Date() } }).catch(() => {});

    // Write the booking into THIS contractor's calendar, then notify both parties.
    await createCalendarEvent(appointmentId, contractorId).catch((e: unknown) =>
      console.error("[contractorBilling] calendar push failed:", e instanceof Error ? e.message : e),
    );
    await notifyBooking(contractor, appt);

    // Proactive top-up: if that booking used their last credit (wallet hit £0),
    // recharge £1,200 NOW for the next 3. Fire-and-forget — if the card fails it
    // alerts, and the next round-robin assignment retries it (fresh idempotency window).
    if (paid) {
      const bal = await prisma.contractor
        .findUnique({ where: { id: contractorId }, select: { prepaidCreditRemaining: true } })
        .catch(() => null);
      if (bal && bal.prepaidCreditRemaining <= 0) void ensureCreditOrRecharge(contractorId);
    }

    if (!paid) {
      await sendAgencyAlert(appt.tenantId, {
        agentName: "Aurum Billing",
        clientName: contractor.name,
        actionType: "PAYMENT_FAILED",
        issue: `Booked a survey to ${contractor.name} (${contractor.city}) but they had no credit and the £${contractor.lockInFeeGbp} top-up failed.`,
        recommended: "Booking kept — chase their card.",
        blueprintId: appt.blueprintId,
      });
      return { outcome: "failed", reason: "no_credit", contractorId };
    }
    console.info(`[contractorBilling] booking ${appointmentId} → contractor ${contractorId} (credit consumed)`);
    return { outcome: "credit_consumed", contractorId };
  } catch (err: unknown) {
    console.error("[contractorBilling] routeAndChargeBooking error:", err instanceof Error ? err.message : err);
    return { outcome: "failed", reason: "unexpected_error" };
  }
}

/** Back-compat alias. */
export const chargeForBooking = routeAndChargeBooking;
