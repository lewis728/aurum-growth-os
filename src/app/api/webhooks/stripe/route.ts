/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events for subscription lifecycle management.
 *
 * Registered events:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.paid
 *
 * MUST be registered with express.raw before express.json.
 * In Next.js App Router, we read the raw body manually.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { lockInCredits } from "@/lib/services/contractorBillingService";
import { sendAgencyAlert } from "@/lib/services/alertService";

export const dynamic = "force-dynamic";

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return secret;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const stripe = getStripeClient();
  const webhookSecret = getWebhookSecret();

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] Signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Test event passthrough — required for Stripe webhook verification
  if (event.id.startsWith("evt_test_")) {
    console.log("[stripe-webhook] Test event detected, returning verification response");
    return NextResponse.json({ verified: true });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        if (!tenantId) {
          console.warn("[stripe-webhook] Subscription missing tenantId metadata:", subscription.id);
          break;
        }

        const trialEnd = subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null;
        // In Stripe SDK v22, current_period_end moved to subscription.items.data[0]
        const firstItem = subscription.items?.data?.[0];
        const periodEnd = firstItem?.current_period_end
          ? new Date(firstItem.current_period_end * 1000)
          : null;

        await prisma.agencySubscription.upsert({
          where: { tenantId },
          create: {
            tenantId,
            stripeCustomerId: typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id,
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            platformPriceId: process.env.STRIPE_PLATFORM_PRICE_ID ?? "",
            seatPriceId: process.env.STRIPE_SEAT_PRICE_ID ?? "",
            currentSeatCount: 0,
            trialEndsAt: trialEnd,
            currentPeriodEnd: periodEnd,
          },
          update: {
            status: subscription.status,
            trialEndsAt: trialEnd,
            currentPeriodEnd: periodEnd,
          },
        });

        console.info(`[stripe-webhook] Subscription ${event.type} for tenantId=${tenantId}, status=${subscription.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenantId;
        if (!tenantId) break;

        await prisma.agencySubscription.updateMany({
          where: { tenantId },
          data: { status: "canceled" },
        });

        console.info(`[stripe-webhook] Subscription canceled for tenantId=${tenantId}`);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = invoice.metadata?.tenantId;
        if (!tenantId) break;

        // Mark matching SpendFeeRecord as paid if this invoice matches
        const periodMonth = invoice.metadata?.periodMonth;
        if (periodMonth) {
          await prisma.spendFeeRecord.updateMany({
            where: { tenantId, periodMonth, status: "invoiced" },
            data: { status: "paid" },
          });
          console.info(`[stripe-webhook] SpendFeeRecord marked paid for tenantId=${tenantId} period=${periodMonth}`);
        }
        break;
      }

      // ── Contractor lock-in paid (£700) → save card + grant prepaid credits ──
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const contractorId = session.metadata?.contractorId;
        if (!contractorId || session.metadata?.kind !== "lockin") break;

        const contractor = await prisma.contractor.findUnique({ where: { id: contractorId } });
        if (!contractor) {
          console.warn(`[stripe-webhook] checkout.session.completed for unknown contractor ${contractorId}`);
          break;
        }

        // Resolve the saved payment method off the PaymentIntent.
        const piRef = session.payment_intent;
        const piId = typeof piRef === "string" ? piRef : piRef?.id ?? null;
        let paymentMethodId: string | null = null;
        if (piId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(piId);
            paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id ?? null;
          } catch (e: unknown) {
            console.warn(`[stripe-webhook] could not retrieve PI ${piId}:`, e instanceof Error ? e.message : e);
          }
        }

        const credits = lockInCredits(contractor);
        // Idempotent: grant the lock-in credits exactly once (guard on lockInPaidAt).
        const res = await prisma.contractor.updateMany({
          where: { id: contractorId, lockInPaidAt: null },
          data: {
            stripePaymentMethodId: paymentMethodId ?? contractor.stripePaymentMethodId,
            stripeCustomerId:
              typeof session.customer === "string" ? session.customer : contractor.stripeCustomerId,
            prepaidCreditRemaining: credits,
            lockInPaidAt: new Date(),
            status: "active",
          },
        });
        console.info(
          res.count === 0
            ? `[stripe-webhook] contractor ${contractorId} lock-in already processed — skipping`
            : `[stripe-webhook] contractor ${contractorId} locked in: ${credits} prepaid credits, card saved`,
        );
        break;
      }

      // ── Async survey-charge failure (safety net for off-session declines) ──
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const appointmentId = pi.metadata?.appointmentId;
        if (!appointmentId || pi.metadata?.kind !== "survey") break;

        const charge = await prisma.surveyCharge.findUnique({
          where: { appointmentId },
          include: { contractor: true },
        });
        if (!charge) break;
        // Already settled synchronously — don't double-write or double-alert.
        if (charge.status === "failed" || charge.status === "paid" || charge.status === "credit_consumed") break;

        const reason = pi.last_payment_error?.code ?? pi.last_payment_error?.message ?? "payment_failed";
        await prisma.surveyCharge.update({
          where: { appointmentId },
          data: { status: "failed", failureReason: reason, stripePaymentIntentId: pi.id },
        });
        await sendAgencyAlert(charge.tenantId, {
          agentName: "Aurum Billing",
          clientName: charge.contractor.name,
          actionType: "PAYMENT_FAILED",
          issue: `Couldn't charge £${charge.amountGbp} for a booked site survey in ${charge.contractor.city} — ${reason}.`,
          recommended: "Booking kept. Chase the contractor's card.",
          blueprintId: charge.blueprintId,
        });
        console.info(`[stripe-webhook] survey charge for ${appointmentId} marked failed: ${reason}`);
        break;
      }

      default:
        console.info(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Error processing event ${event.type}:`, message);
    // Return 200 to prevent Stripe retries for processing errors
    return NextResponse.json({ received: true, error: message });
  }

  return NextResponse.json({ received: true });
}
