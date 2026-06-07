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
 *   2. PER BOOKING: when the Retell bot books a survey (scheduler.ts), we ROUTE it
 *      to the active contractor for that city + vertical and charge £350 — consuming
 *      a prepaid credit first, else an off-session PaymentIntent. On success the
 *      booking is pushed into THAT contractor's calendar. If the primary's card
 *      fails we try the next contractor (backup routing); if all fail we keep the
 *      booking, drop it on Lewis's calendar, and alert.
 *
 * Golden rules (mirroring stripeService.ts):
 *   - routeAndChargeBooking() NEVER THROWS — it runs inside the post-call path.
 *   - SurveyCharge.appointmentId @unique guarantees a booking is charged at most
 *     once (idempotent against Retell retries / webhook replays).
 *   - A failed charge NEVER reverses the booking.
 *   - stripeCustomerId / stripePaymentMethodId are Stripe references, not secrets.
 *   - Zero `any`, zero `@ts-ignore`.
 */

import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { sendAgencyAlert } from "@/lib/services/alertService";
import { createCalendarEvent } from "@/lib/services/calendarService";
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

// ─── Per-booking routing + charging ─────────────────────────────────────────────

export type ChargeOutcome = "credit_consumed" | "paid" | "failed" | "skipped";
export interface ChargeResult {
  outcome: ChargeOutcome;
  reason?: string;
  contractorId?: string;
}

interface SettleResult {
  ok: boolean;
  kind?: "credit" | "charge";
  piId?: string;
  reason?: string;
}

/**
 * Settle one booking against ONE specific contractor: prepaid credit first, else an
 * off-session card charge. NEVER THROWS — returns ok:false on any failure so the
 * caller can fall through to a backup contractor. Does NOT write the ledger row
 * (the orchestrator commits it for the winner). Idempotency key is per
 * (appointment, contractor) so retrying one contractor can't double-charge, while
 * trying a different contractor is a distinct charge.
 */
async function attemptSettleForContractor(
  appointmentId: string,
  contractor: Contractor,
  tenantId: string,
): Promise<SettleResult> {
  // 1. Prepaid credit first — atomic conditional decrement (race-safe).
  try {
    const dec = await prisma.contractor.updateMany({
      where: { id: contractor.id, prepaidCreditRemaining: { gt: 0 } },
      data: { prepaidCreditRemaining: { decrement: 1 } },
    });
    if (dec.count === 1) return { ok: true, kind: "credit" };
  } catch (e) {
    console.error("[contractorBilling] credit decrement failed:", e instanceof Error ? e.message : e);
  }

  // 2. Off-session card charge.
  if (!contractor.stripeCustomerId || !contractor.stripePaymentMethodId) {
    return { ok: false, reason: "no_saved_card" };
  }
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: toPence(contractor.pricePerSurveyGbp),
        currency: "gbp",
        customer: contractor.stripeCustomerId,
        payment_method: contractor.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Site survey booking — ${contractor.city}`,
        metadata: { appointmentId, contractorId: contractor.id, tenantId, kind: "survey" },
      },
      { idempotencyKey: `survey:${appointmentId}:${contractor.id}` },
    );
    if (pi.status === "succeeded") return { ok: true, kind: "charge", piId: pi.id };
    // Off-session can't complete an interactive step (e.g. requires_action / 3DS).
    return { ok: false, reason: `payment_intent_status:${pi.status}`, piId: pi.id };
  } catch (e: unknown) {
    const reason =
      e instanceof Stripe.errors.StripeError ? (e.code ?? e.message) : e instanceof Error ? e.message : String(e);
    return { ok: false, reason };
  }
}

/**
 * Route a booked survey to the right contractor for its city + vertical and charge
 * them, with backup routing. NEVER THROWS. Called from the scheduler right after the
 * appointment is created (this also owns the calendar push, so the booking only
 * lands in a contractor's diary once they've actually paid).
 */
export async function routeAndChargeBooking(appointmentId: string): Promise<ChargeResult> {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        tenantId: true,
        blueprintId: true,
        blueprint: { select: { targetLocation: true, vertical: true } },
        surveyCharge: { select: { status: true } },
      },
    });

    if (!appt) {
      console.warn(`[contractorBilling] appointment ${appointmentId} not found — skipping`);
      return { outcome: "skipped", reason: "appointment_not_found" };
    }

    // Idempotency: a settled booking is never charged again.
    if (appt.surveyCharge?.status === "paid" || appt.surveyCharge?.status === "credit_consumed") {
      return { outcome: "skipped", reason: "already_settled" };
    }

    const city = appt.blueprint?.targetLocation?.trim() ?? null;
    const vertical = appt.blueprint?.vertical ?? null;

    // Active contractors for this territory, primary first (priority asc).
    const contractors =
      city && vertical
        ? await prisma.contractor.findMany({
            where: {
              tenantId: appt.tenantId,
              status: "active",
              vertical,
              city: { equals: city, mode: "insensitive" },
            },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
          })
        : [];

    if (contractors.length === 0) {
      // Unsold / unrouted territory — don't lose the booking: tenant calendar + alert.
      await createCalendarEvent(appointmentId).catch(() => {});
      await sendAgencyAlert(appt.tenantId, {
        agentName: "Aurum Routing",
        clientName: city ? `${city} (${vertical ?? "?"})` : "Unknown territory",
        actionType: "NO_CONTRACTOR",
        issue: `A survey booked but no active contractor covers ${city ?? "this city"} (${vertical ?? "?"}).`,
        recommended: "Sell/assign this territory, then re-route the booking.",
        blueprintId: appt.blueprintId,
      });
      return { outcome: "skipped", reason: "no_contractor" };
    }

    const primary = contractors[0]!;

    // Claim the ledger row (unique appointmentId). A P2002 means a concurrent
    // create; re-read and bail if already settled, else (re)attempt below.
    try {
      await prisma.surveyCharge.create({
        data: {
          appointmentId,
          contractorId: primary.id,
          tenantId: appt.tenantId,
          blueprintId: appt.blueprintId,
          amountGbp: primary.pricePerSurveyGbp,
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
        console.error(`[contractorBilling] could not create ledger row for ${appointmentId}`);
        return { outcome: "failed", reason: "ledger_create_failed" };
      }
      if (existing.status === "paid" || existing.status === "credit_consumed") {
        return { outcome: "skipped", reason: "already_settled" };
      }
    }

    // Try each contractor in priority order until one settles.
    const failures: string[] = [];
    for (let i = 0; i < contractors.length; i++) {
      const c = contractors[i]!;
      const res = await attemptSettleForContractor(appointmentId, c, appt.tenantId);
      if (res.ok) {
        await prisma.surveyCharge.update({
          where: { appointmentId },
          data: {
            contractorId: c.id,
            amountGbp: c.pricePerSurveyGbp,
            kind: res.kind === "credit" ? "credit" : "charge",
            status: res.kind === "credit" ? "credit_consumed" : "paid",
            stripePaymentIntentId: res.piId ?? null,
            failureReason: null,
          },
        });
        // The booking lands in the WINNING contractor's own calendar.
        await createCalendarEvent(appointmentId, c.id).catch((e: unknown) =>
          console.error("[contractorBilling] calendar push failed:", e instanceof Error ? e.message : e),
        );
        const label = res.kind === "credit" ? "prepaid credit" : `£${c.pricePerSurveyGbp} charge`;
        console.info(`[contractorBilling] survey ${appointmentId} → contractor ${c.id} (${label})`);
        if (i > 0) {
          await sendAgencyAlert(appt.tenantId, {
            agentName: "Aurum Routing",
            clientName: c.name,
            actionType: "BACKUP_ROUTED",
            issue: `Primary contractor's charge failed in ${c.city}; routed to backup ${c.name}.`,
            recommended: "Check the primary contractor's card.",
            blueprintId: appt.blueprintId,
          });
        }
        return { outcome: res.kind === "credit" ? "credit_consumed" : "paid", contractorId: c.id };
      }
      failures.push(`${c.name}: ${res.reason ?? "unknown"}`);
    }

    // All contractors failed — keep the booking, drop it on Lewis's calendar, alert.
    await prisma.surveyCharge
      .update({
        where: { appointmentId },
        data: { status: "failed", contractorId: primary.id, failureReason: failures.join(" | ").slice(0, 480) },
      })
      .catch(() => {});
    await createCalendarEvent(appointmentId).catch(() => {});
    await sendAgencyAlert(appt.tenantId, {
      agentName: "Aurum Billing",
      clientName: primary.city,
      actionType: "PAYMENT_FAILED",
      issue: `All ${contractors.length} contractor(s) in ${primary.city} failed to charge for a booked survey: ${failures.join(" | ")}.`,
      tried: "Off-session charge against each active contractor in priority order.",
      recommended: "Booking held 24h. Fix a card or assign another contractor.",
      blueprintId: appt.blueprintId,
    });
    return { outcome: "failed", reason: "all_contractors_failed" };
  } catch (err: unknown) {
    // Absolute backstop — must never throw into the scheduler.
    console.error("[contractorBilling] routeAndChargeBooking error:", err instanceof Error ? err.message : err);
    return { outcome: "failed", reason: "unexpected_error" };
  }
}

/**
 * Back-compat alias. The scheduler calls routeAndChargeBooking directly; older
 * call sites that imported chargeForBooking keep working.
 */
export const chargeForBooking = routeAndChargeBooking;
