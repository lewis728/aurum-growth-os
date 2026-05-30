/**
 * src/lib/services/stripeService.ts
 * SERVER-SIDE ONLY. Never import inside a "use client" component.
 *
 * Per-seat billing for Aurum Growth OS.
 *
 * Billing model:
 *   Platform access:  £97/month (STRIPE_PLATFORM_PRICE_ID)
 *   Client seats:     £500/month per active CampaignBlueprint (STRIPE_SEAT_PRICE_ID)
 *   Ad spend fee:     5% of monthly Meta spend, invoiced on the 1st via cron
 *
 * Golden rules:
 *   - validateStripeMandate() NEVER throws — always returns boolean
 *   - Seat count never goes below 0
 *   - SpendFeeRecord @@unique([tenantId, periodMonth]) prevents double-charging
 *   - Zero any, zero ts-ignore
 */

import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { CampaignStatus } from "@/enums/campaignEnums";
import type { AgencySubscription } from "@prisma/client";
import { getCampaignInsights } from "@/lib/services/metaAdsService";

// ─── Stripe Client ────────────────────────────────────────────────────────────

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

function getPlatformPriceId(): string {
  const id = process.env.STRIPE_PLATFORM_PRICE_ID;
  if (!id) throw new Error("STRIPE_PLATFORM_PRICE_ID is not configured");
  return id;
}

function getSeatPriceId(): string {
  const id = process.env.STRIPE_SEAT_PRICE_ID;
  if (!id) throw new Error("STRIPE_SEAT_PRICE_ID is not configured");
  return id;
}

// ─── createOrRetrieveCustomer ─────────────────────────────────────────────────

/**
 * Looks up an existing Stripe customer by metadata.tenantId.
 * Creates a new customer if none found.
 * Returns the Stripe customerId string.
 */
export async function createOrRetrieveCustomer(
  tenantId: string,
  email: string,
  orgName: string
): Promise<string> {
  const stripe = getStripeClient();

  const existing = await stripe.customers.search({
    query: `metadata["tenantId"]:"${tenantId}"`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0].id;
  }

  const customer = await stripe.customers.create({
    email,
    name: orgName,
    metadata: { tenantId },
  });

  return customer.id;
}

// ─── createAgencySubscription ─────────────────────────────────────────────────

/**
 * Creates a Stripe subscription with platform + seat line items.
 * 14-day trial, payment_behavior: default_incomplete.
 * Upserts AgencySubscription row in DB.
 * Returns the DB record.
 */
export async function createAgencySubscription(
  tenantId: string,
  customerId: string
): Promise<AgencySubscription> {
  const stripe = getStripeClient();
  const platformPriceId = getPlatformPriceId();
  const seatPriceId = getSeatPriceId();

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [
      { price: platformPriceId, quantity: 1 },
      { price: seatPriceId, quantity: 0 },
    ],
    trial_period_days: 14,
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    metadata: { tenantId },
    expand: ["latest_invoice.payment_intent"],
  });

  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : null;
  // In Stripe SDK v22, current_period_end moved to subscription.items.data[0]
  const firstItem = subscription.items?.data?.[0];
  const periodEnd = firstItem?.current_period_end
    ? new Date(firstItem.current_period_end * 1000)
    : null;

  const record = await prisma.agencySubscription.upsert({
    where: { tenantId },
    create: {
      tenantId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      platformPriceId,
      seatPriceId,
      currentSeatCount: 0,
      trialEndsAt: trialEnd,
      currentPeriodEnd: periodEnd,
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      platformPriceId,
      seatPriceId,
      trialEndsAt: trialEnd,
      currentPeriodEnd: periodEnd,
    },
  });

  return record;
}

// ─── addClientSeat ────────────────────────────────────────────────────────────

/**
 * Increments the seat quantity on the Stripe subscription by 1.
 * Updates AgencySubscription.currentSeatCount in DB.
 * Called automatically when a new CampaignBlueprint is created.
 */
export async function addClientSeat(tenantId: string): Promise<void> {
  const stripe = getStripeClient();
  const seatPriceId = getSeatPriceId();

  const sub = await prisma.agencySubscription.findUnique({ where: { tenantId } });
  if (!sub) {
    console.warn(`[stripeService.addClientSeat] No subscription found for tenantId=${tenantId}`);
    return;
  }

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const seatItem = stripeSub.items.data.find((item) => item.price.id === seatPriceId);

  if (!seatItem) {
    console.warn(`[stripeService.addClientSeat] Seat item not found on subscription ${sub.stripeSubscriptionId}`);
    return;
  }

  const newCount = sub.currentSeatCount + 1;

  await stripe.subscriptionItems.update(seatItem.id, {
    quantity: newCount,
    proration_behavior: "create_prorations",
  });

  await prisma.agencySubscription.update({
    where: { tenantId },
    data: { currentSeatCount: newCount },
  });

  console.info(`[stripeService.addClientSeat] tenantId=${tenantId} seats: ${sub.currentSeatCount} → ${newCount}`);
}

// ─── removeClientSeat ─────────────────────────────────────────────────────────

/**
 * Decrements the seat quantity on the Stripe subscription by 1.
 * Never goes below 0. Updates AgencySubscription.currentSeatCount in DB.
 * Called when a CampaignBlueprint is archived or deleted.
 */
export async function removeClientSeat(tenantId: string): Promise<void> {
  const stripe = getStripeClient();
  const seatPriceId = getSeatPriceId();

  const sub = await prisma.agencySubscription.findUnique({ where: { tenantId } });
  if (!sub) {
    console.warn(`[stripeService.removeClientSeat] No subscription found for tenantId=${tenantId}`);
    return;
  }

  const newCount = Math.max(0, sub.currentSeatCount - 1);

  if (newCount === sub.currentSeatCount) {
    console.info(`[stripeService.removeClientSeat] tenantId=${tenantId} already at 0 seats — no change`);
    return;
  }

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const seatItem = stripeSub.items.data.find((item) => item.price.id === seatPriceId);

  if (!seatItem) {
    console.warn(`[stripeService.removeClientSeat] Seat item not found on subscription ${sub.stripeSubscriptionId}`);
    return;
  }

  await stripe.subscriptionItems.update(seatItem.id, {
    quantity: newCount,
    proration_behavior: "create_prorations",
  });

  await prisma.agencySubscription.update({
    where: { tenantId },
    data: { currentSeatCount: newCount },
  });

  console.info(`[stripeService.removeClientSeat] tenantId=${tenantId} seats: ${sub.currentSeatCount} → ${newCount}`);
}

// ─── getSubscriptionStatus ────────────────────────────────────────────────────

export interface SubscriptionStatus {
  status: string;
  seatCount: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * Returns the current subscription status from the DB.
 * Returns null if no subscription exists for this tenant.
 */
export async function getSubscriptionStatus(
  tenantId: string
): Promise<SubscriptionStatus | null> {
  const sub = await prisma.agencySubscription.findUnique({ where: { tenantId } });
  if (!sub) return null;

  return {
    status: sub.status,
    seatCount: sub.currentSeatCount,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
  };
}

// ─── Tiered pricing (Sprint 7) ────────────────────────────────────────────────
// Flat platform fee + per-client seats priced by tier.
export const PRICING = {
  platform:     97,   // £/month platform access
  starter:      200,  // £/month per Starter client seat
  full_service: 500,  // £/month per Full-service client seat
} as const;

export function computeMonthlyTotal(starterSeats: number, fullServiceSeats: number): number {
  return PRICING.platform + starterSeats * PRICING.starter + fullServiceSeats * PRICING.full_service;
}

/**
 * Whether the platform is usable for creating new clients.
 * - No subscription row yet → true (onboarding grace; they subscribe later).
 * - active → true.
 * - trialing → true until trialEndsAt passes.
 * - past_due / canceled → false.
 */
export function isPlatformActive(status: SubscriptionStatus | null): boolean {
  if (!status) return true;
  if (status.status === "active") return true;
  if (status.status === "trialing") {
    if (!status.trialEndsAt) return true;
    return status.trialEndsAt.getTime() > Date.now();
  }
  return false;
}

// ─── createCheckoutSession ────────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout session in subscription mode.
 * 14-day trial. Returns the session URL.
 */
export async function createCheckoutSession(
  tenantId: string,
  customerId: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const stripe = getStripeClient();
  const platformPriceId = getPlatformPriceId();
  const seatPriceId = getSeatPriceId();

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      { price: platformPriceId, quantity: 1 },
      { price: seatPriceId, quantity: 0 },
    ],
    subscription_data: {
      trial_period_days: 14,
      metadata: { tenantId },
    },
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { tenantId },
  });

  if (!session.url) {
    throw new Error("[stripeService.createCheckoutSession] Stripe returned no session URL");
  }

  return session.url;
}

// ─── createBillingPortalSession ───────────────────────────────────────────────

/**
 * Creates a Stripe Customer Portal session.
 * Returns the portal URL.
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripeClient();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

// ─── validateStripeMandate ────────────────────────────────────────────────────

/**
 * Returns true if the tenant has an active or trialing subscription.
 * Returns false for any other state or if no subscription exists.
 * NEVER throws — returns false on any error.
 */
export async function validateStripeMandate(tenantId: string): Promise<boolean> {
  try {
    const sub = await prisma.agencySubscription.findUnique({ where: { tenantId } });
    if (!sub) return false;
    return sub.status === "active" || sub.status === "trialing";
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripeService.validateStripeMandate] Error for tenantId=${tenantId}: ${message}`);
    return false;
  }
}

// ─── calculateAndCreateSpendFee ───────────────────────────────────────────────

/**
 * Calculates 5% of total Meta ad spend for the period and invoices it.
 * Skips if fee < £1.00 (Stripe minimum).
 * Uses @@unique([tenantId, periodMonth]) to prevent double-charging.
 * Called by the monthly cron job on the 1st of each month.
 */
export async function calculateAndCreateSpendFee(
  tenantId: string,
  periodMonth: string // "YYYY-MM" format
): Promise<void> {
  const stripe = getStripeClient();

  const sub = await prisma.agencySubscription.findUnique({ where: { tenantId } });
  if (!sub) {
    console.warn(`[stripeService.calculateAndCreateSpendFee] No subscription for tenantId=${tenantId}`);
    return;
  }

  const blueprints = await prisma.campaignBlueprint.findMany({
    where: { tenantId, status: CampaignStatus.LIVE },
    select: { id: true, crm: true },
  });

  if (blueprints.length === 0) {
    console.info(`[stripeService.calculateAndCreateSpendFee] No LIVE blueprints for tenantId=${tenantId} in ${periodMonth}`);
    return;
  }

  const [year, month] = periodMonth.split("-").map(Number);
  const since = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const until = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const USD_TO_GBP = 0.787;
  let totalSpendGbp = 0;

  for (const blueprint of blueprints) {
    try {
      const crmLayer = blueprint.crm as Record<string, unknown>;
      const metaCampaignId = crmLayer?.metaCampaignId as string | undefined;
      if (!metaCampaignId) continue;

      const insights = await getCampaignInsights(
        metaCampaignId,
        { since, until },
        tenantId
      );

      const spendUsd = parseFloat((insights?.spend as string) ?? "0");
      totalSpendGbp += spendUsd * USD_TO_GBP;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[stripeService.calculateAndCreateSpendFee] Could not fetch insights for blueprint ${blueprint.id}: ${message}`);
    }
  }

  const feeGbp = parseFloat((totalSpendGbp * 0.05).toFixed(2));

  if (feeGbp < 1.0) {
    console.info(`[stripeService.calculateAndCreateSpendFee] Fee £${feeGbp} below £1.00 minimum — skipping for tenantId=${tenantId}`);
    return;
  }

  let feeRecord;
  try {
    feeRecord = await prisma.spendFeeRecord.create({
      data: {
        tenantId,
        periodMonth,
        totalSpendGbp,
        feeGbp,
        status: "pending",
      },
    });
  } catch {
    console.info(`[stripeService.calculateAndCreateSpendFee] SpendFeeRecord already exists for tenantId=${tenantId} period=${periodMonth} — skipping`);
    return;
  }

  const invoiceItem = await stripe.invoiceItems.create({
    customer: sub.stripeCustomerId,
    amount: Math.round(feeGbp * 100),
    currency: "gbp",
    description: `Aurum ad spend management fee (5% of £${totalSpendGbp.toFixed(2)} spend) — ${periodMonth}`,
  });

  const invoice = await stripe.invoices.create({
    customer: sub.stripeCustomerId,
    auto_advance: true,
    description: `Aurum ad spend management fee — ${periodMonth}`,
    metadata: { tenantId, periodMonth },
  });

  await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(invoice.id);

  await prisma.spendFeeRecord.update({
    where: { id: feeRecord.id },
    data: {
      stripeInvoiceId: invoice.id,
      status: "invoiced",
    },
  });

  console.info(
    `[stripeService.calculateAndCreateSpendFee] Invoiced £${feeGbp} fee for tenantId=${tenantId} period=${periodMonth}. ` +
    `Invoice: ${invoice.id}, InvoiceItem: ${invoiceItem.id}`
  );
}
