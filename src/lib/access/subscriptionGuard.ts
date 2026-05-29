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
export async function canLaunchCampaign(tenantId: string): Promise<AccessResult> {
  try {
    const sub = await prisma.agencySubscription.findUnique({
      where: { tenantId },
    });

    // STATE 1: No subscription
    if (!sub) {
      return {
        allowed: false,
        state: "none",
        reason: "No active subscription. Start your free trial to launch your first client campaign.",
      };
    }

    // STATE 4: Past due or canceled
    if (sub.status === "past_due" || sub.status === "canceled") {
      return {
        allowed: false,
        state: "past_due",
        reason:
          "Your account has a payment issue. Please update your payment method to continue launching campaigns.",
      };
    }

    // STATE 2: Trialing — enforce 3-seat cap
    if (sub.status === "trialing") {
      const activeSeatCount = await prisma.campaignBlueprint.count({
        where: {
          tenantId,
          status: { notIn: INACTIVE_STATUSES },
        },
      });

      const trialEndsAt = sub.trialEndsAt ?? undefined;

      if (activeSeatCount >= TRIAL_SEAT_CAP) {
        return {
          allowed: false,
          state: "trialing",
          reason:
            "You have reached the trial limit of 3 clients. Subscribe to add unlimited clients.",
          seatCount: activeSeatCount,
          trialEndsAt,
        };
      }

      return {
        allowed: true,
        state: "trialing",
        seatCount: activeSeatCount,
        trialEndsAt,
      };
    }

    // STATE 3: Active — no restrictions
    if (sub.status === "active") {
      return {
        allowed: true,
        state: "active",
      };
    }

    // Unknown status — treat as no subscription
    return {
      allowed: false,
      state: "none",
      reason: "No active subscription. Start your free trial to launch your first client campaign.",
    };
  } catch {
    return { allowed: false, state: "none" };
  }
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
