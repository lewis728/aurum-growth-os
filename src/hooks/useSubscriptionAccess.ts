/**
 * src/hooks/useSubscriptionAccess.ts
 *
 * SOLO TEST OVERRIDE: the subscription gate is disabled. This hook always
 * returns permissive "active" access — no API call, no Stripe check — so the
 * SubscriptionBanner overlay never blocks the dashboard while Stripe billing
 * is not yet set up.
 *
 * To re-enable real billing: restore the SWR fetch of /api/billing/status and
 * the deriveState logic (see git history for the original implementation).
 *
 * "use client" — this hook runs in the browser only.
 */

"use client";

import type { SubscriptionState } from "@/lib/access/subscriptionGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionAccess {
  state: SubscriptionState;
  canLaunch: boolean;
  isPastDue: boolean;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  seatCount: number;
  isLoading: boolean;
}

// ─── Hook (permissive override) ─────────────────────────────────────────────────

// Always-active access. The dashboard is fully usable with no billing checks.
const PERMISSIVE_ACCESS: SubscriptionAccess = {
  state: "active",
  canLaunch: true,
  isPastDue: false,
  isTrialing: false,
  trialEndsAt: null,
  seatCount: 0,
  isLoading: false,
};

export function useSubscriptionAccess(): SubscriptionAccess {
  return PERMISSIVE_ACCESS;
}
