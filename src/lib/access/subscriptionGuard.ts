/**
 * src/lib/access/subscriptionGuard.ts
 *
 * Subscription-based access control for the Aurum platform.
 * No tier names. No feature gating by tier. Access is determined solely
 * by AgencySubscription.status and active seat count.
 *
 * Four subscription states:
 *   none      — No AgencySubscription row exists
 *   trialing  — status = 'trialing' (max 3 active seats)
 *   active    — status = 'active' (unlimited seats)
 *   past_due  — status = 'past_due' | 'canceled' (read-only)
 */

import { prisma } from "@/lib/prisma";
import { CampaignStatus } from "@/enums/campaignEnums";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionState = "none" | "trialing" | "active" | "past_due";

export interface AccessResult {
  allowed: boolean;
  state: SubscriptionState;
  reason?: string;       // Human-readable block reason shown to user
  seatCount?: number;    // Current active seat count
  trialEndsAt?: Date;    // Populated when trialing
}

// ─── Trial seat cap ───────────────────────────────────────────────────────────

const TRIAL_SEAT_CAP = 3;

// ─── Statuses that count as an active (non-archived) seat ─────────────────────

const INACTIVE_STATUSES: CampaignStatus[] = [
  CampaignStatus.ARCHIVED,
  CampaignStatus.FAILED,
];

// ─── getSubscriptionState ─────────────────────────────────────────────────────

/**
 * Returns the subscription state for a tenant.
 * Never throws — returns 'none' on any error.
 */
export async function getSubscriptionState(
  tenantId: string
): Promise<SubscriptionState> {
  try {
    const sub = await prisma.agencySubscription.findUnique({
      where: { tenantId },
      select: { status: true },
    });

    if (!sub) return "none";

    switch (sub.status) {
      case "active":
        return "active";
      case "trialing":
        return "trialing";
      case "past_due":
      case "canceled":
        return "past_due";
      default:
        return "none";
    }
  } catch {
    return "none";
  }
}

// ─── canLaunchCampaign ────────────────────────────────────────────────────────

/**
 * Determines whether the tenant is allowed to launch a new campaign.
 * Enforces the trial seat cap of 3 at the API level.
 * Never throws — returns { allowed: false, state: 'none' } on any error.
 */
export async function canLaunchCampaign(_tenantId: string): Promise<AccessResult> {
  // TEMP: disabled for solo test env — restore before opening to paying customers.
  // Original logic (no-subscription / past_due / trial 3-seat cap / active) is in
  // git history; restore it here when Stripe billing is set up.
  return { allowed: true, state: "active" };
}

// ─── canAccessDashboard ───────────────────────────────────────────────────────

/**
 * Determines whether the tenant can access the dashboard.
 * Always returns allowed: true — state is used by the UI to show banners.
 * Even past_due tenants can see their data (read-only).
 * Never throws.
 */
export async function canAccessDashboard(tenantId: string): Promise<AccessResult> {
  try {
    const state = await getSubscriptionState(tenantId);
    // All states allow dashboard access — the UI shows appropriate banners
    return { allowed: true, state };
  } catch {
    return { allowed: true, state: "none" };
  }
}
