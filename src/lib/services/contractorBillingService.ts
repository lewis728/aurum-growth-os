/**
 * src/lib/services/contractorBillingService.ts
 * SERVER-SIDE ONLY. Never import inside a "use client" component.
 *
 * Per-booking billing for the business pivot (see memory `business-model-pivot`).
 * Aurum captures roofing demand per city and SELLS booked site-survey appointments
 * to the local roofing contractor:
 *
 *   1. LOCK-IN: onboarding takes a £700 up-front payment (Stripe Checkout, mode
 *      "payment", setup_future_usage=off_session) which both SAVES the contractor's
 *      card and pre-pays the first 2 surveys (700 / 350). The webhook grants the
 *      prepaid credits — see /api/webhooks/stripe.
 *   2. PER BOOKING: when the Retell bot books a survey (scheduler.ts), we charge
 *      the contractor £350 — consuming a prepaid credit first, else an off-session
 *      PaymentIntent against the saved card.
 *
 * Golden rules (mirroring stripeService.ts):
 *   - chargeForBooking() NEVER THROWS — it runs inside the post-call path.
 *   - SurveyCharge.appointmentId @unique guarantees a booking is charged at most
 *     once (idempotent against Retell retries / webhook replays).
 *   - A failed charge NEVER reverses the booking — we keep it and alert Lewis.
 *   - stripeCustomerId / stripePaymentMethodId are Stripe references, not secrets.
 *   - Zero `any`, zero `@ts-ignore`.
 */

import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { sendAgencyAlert } from "@/lib/services/alertService";
import type { Contractor } from "@prisma/client";

// ─── Stripe client (same version pin as stripeService.ts) ───────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

/** Integer GBP → integer pence. Amounts are stored as whole pounds. */
function toPence(gbp: number): number {
  return Math.round(gbp) * 100;
}

/**
 * Number of surveys the lock-in fee pre-pays = floor(lockInFee / pricePerSurvey).
 * Default 700 / 350 = 2. Computed so it stays correct if pricing changes.
 */
export function lockInCredits(contractor: Pick<Contractor, "lockInFeeGbp" | "pricePerSurveyGbp">): number {
  if (contractor.pricePerSurveyGbp <= 0) return 0;
  return Math.floor(contractor.lockInFeeGbp / contractor.pricePerSurveyGbp);
}

// ─── ensureContractorCustomer ───────────────────────────────────────────────────

/**
 * Returns the contractor's Stripe customer id, creating + persisting one on first
 * use. Keyed by contractorId (NOT tenantId — every contractor shares Lewis's one
 * tenant, so the stripeService tenant-keyed customer lookup would collide).
 */
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

  await prisma.contractor.update({
    where: { id: contractor.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

// ─── startContractorLockIn ──────────────────────────────────────────────────────

/**
 * Creates the £700 lock-in Checkout Session. mode "payment" + setup_future_usage
 * "off_session" so the card is saved for future per-booking charges. On completion,
 * the Stripe webhook saves the payment method and grants the prepaid credits.
 *
 * Throws on misconfiguration / contractor-not-found — callers are request handlers
 * that surface the error (this is NOT on the never-throw post-call path).
 */
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
          product_data: {
            name: `Site survey lock-in — first ${credits} bookings (${contractor.city})`,
          },
        },
      },
    ],
    // Saves the card + mandate for off-session merchant-initiated charges later.
    payment_intent_data: {
      setup_future_usage: "off_session",
      metadata: { contractorId, tenantId: contractor.tenantId, kind: "lockin" },
    },
    metadata: { contractorId, tenantId: contractor.tenantId, kind: "lockin" },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });

  if (!session.url) {
    throw new Error("[contractorBilling] Stripe returned no Checkout session URL");
  }
  return session.url;
}

// ─── chargeForBooking ───────────────────────────────────────────────────────────

export type ChargeOutcome = "credit_consumed" | "paid" | "failed" | "skipped";
export interface ChargeResult {
  outcome: ChargeOutcome;
  reason?: string;
}

/**
 * Charge the contractor for one booked survey. Called from the scheduler right
 * after the appointment + calendar event are created. NEVER THROWS.
 *
 * Order: idempotency guard → prepaid credit → off-session card charge.
 */
export async function chargeForBooking(appointmentId: string): Promise<ChargeResult> {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        tenantId: true,
        blueprintId: true,
        blueprint: { select: { contractorId: true } },
        surveyCharge: { select: { status: true } },
      },
    });

    if (!appt) {
      console.warn(`[contractorBilling] appointment ${appointmentId} not found — skipping charge`);
      return { outcome: "skipped", reason: "appointment_not_found" };
    }

    // Idempotency: a settled booking is never charged again.
    if (appt.surveyCharge?.status === "paid" || appt.surveyCharge?.status === "credit_consumed") {
      return { outcome: "skipped", reason: "already_settled" };
    }

    const contractorId = appt.blueprint?.contractorId;
    if (!contractorId) {
      console.info(`[contractorBilling] appointment ${appointmentId} has no contractor linked — skipping charge`);
      return { outcome: "skipped", reason: "no_contractor" };
    }

    const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
    if (!contractor || contractor.status !== "active") {
      console.info(`[contractorBilling] contractor ${contractorId} not active — skipping charge`);
      return { outcome: "skipped", reason: "contractor_inactive" };
    }

    const amountGbp = contractor.pricePerSurveyGbp;

    // Claim the booking — create the ledger row (unique appointmentId). A P2002
    // means a concurrent create; re-read. If NO row exists afterwards the create
    // failed for a real reason — bail WITHOUT touching credits, so a transient DB
    // error can never silently burn a prepaid credit.
    try {
      await prisma.surveyCharge.create({
        data: {
          appointmentId,
          contractorId,
          tenantId: appt.tenantId,
          blueprintId: appt.blueprintId,
          amountGbp,
          kind: "charge",
          status: "pending",
        },
      });
    } catch {
      const existing = await prisma.surveyCharge.findUnique({
        where: { appointmentId },
        select: { status: true },
      });
      if (!existing) {
        console.error(`[contractorBilling] could not create ledger row for ${appointmentId} — skipping charge`);
        return { outcome: "failed", reason: "ledger_create_failed" };
      }
      if (existing.status === "paid" || existing.status === "credit_consumed") {
        return { outcome: "skipped", reason: "already_settled" };
      }
      // A pending/failed row already exists — safe to (re)attempt settlement below.
    }

    // 1. Prepaid credit first — atomic conditional decrement (race-safe).
    const dec = await prisma.contractor.updateMany({
      where: { id: contractorId, prepaidCreditRemaining: { gt: 0 } },
      data: { prepaidCreditRemaining: { decrement: 1 } },
    });
    if (dec.count === 1) {
      await prisma.surveyCharge.update({
        where: { appointmentId },
        data: { kind: "credit", status: "credit_consumed", failureReason: null },
      });
      console.info(`[contractorBilling] survey ${appointmentId} covered by prepaid credit for contractor ${contractorId}`);
      return { outcome: "credit_consumed" };
    }

    // 2. Off-session card charge.
    if (!contractor.stripeCustomerId || !contractor.stripePaymentMethodId) {
      return await markFailed(appointmentId, "no_saved_card", contractor, appt.blueprintId, amountGbp);
    }

    try {
      const pi = await getStripe().paymentIntents.create(
        {
          amount: toPence(amountGbp),
          currency: "gbp",
          customer: contractor.stripeCustomerId,
          payment_method: contractor.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          description: `Site survey booking — ${contractor.city}`,
          metadata: { appointmentId, contractorId, tenantId: appt.tenantId, kind: "survey" },
        },
        { idempotencyKey: `survey:${appointmentId}` },
      );

      if (pi.status === "succeeded") {
        await prisma.surveyCharge.update({
          where: { appointmentId },
          data: { status: "paid", stripePaymentIntentId: pi.id, failureReason: null },
        });
        console.info(`[contractorBilling] charged £${amountGbp} for survey ${appointmentId} (PI ${pi.id})`);
        return { outcome: "paid" };
      }

      // Off-session can't complete an interactive step (e.g. requires_action / 3DS).
      return await markFailed(appointmentId, `payment_intent_status:${pi.status}`, contractor, appt.blueprintId, amountGbp, pi.id);
    } catch (e: unknown) {
      const reason =
        e instanceof Stripe.errors.StripeError ? (e.code ?? e.message) : e instanceof Error ? e.message : String(e);
      return await markFailed(appointmentId, reason, contractor, appt.blueprintId, amountGbp);
    }
  } catch (err: unknown) {
    // Absolute backstop — must never throw into the scheduler.
    console.error("[contractorBilling] chargeForBooking error:", err instanceof Error ? err.message : err);
    return { outcome: "failed", reason: "unexpected_error" };
  }
}

/**
 * Marks the SurveyCharge failed and alerts Lewis. The booking is NEVER reversed —
 * we don't un-book a homeowner because the contractor's card failed. NEVER THROWS.
 */
async function markFailed(
  appointmentId: string,
  reason: string,
  contractor: Contractor,
  blueprintId: string | null,
  amountGbp: number,
  stripePaymentIntentId?: string,
): Promise<ChargeResult> {
  try {
    await prisma.surveyCharge.update({
      where: { appointmentId },
      data: { status: "failed", failureReason: reason, stripePaymentIntentId: stripePaymentIntentId ?? null },
    });
  } catch (e) {
    console.error("[contractorBilling] failed to mark SurveyCharge failed:", e instanceof Error ? e.message : e);
  }

  await sendAgencyAlert(contractor.tenantId, {
    agentName: "Aurum Billing",
    clientName: contractor.name,
    actionType: "PAYMENT_FAILED",
    issue: `Couldn't charge £${amountGbp} for a booked site survey in ${contractor.city} — ${reason}.`,
    tried: "Off-session charge against the saved card / prepaid credit.",
    recommended: "Booking kept. Chase the contractor's card or re-take the £" + `${contractor.lockInFeeGbp} lock-in.`,
    blueprintId,
  });

  return { outcome: "failed", reason };
}
