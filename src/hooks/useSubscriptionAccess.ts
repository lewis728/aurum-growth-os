/**
 * src/hooks/useSubscriptionAccess.ts
 *
 * SWR hook that polls GET /api/billing/status every 60 seconds.
 * Derives canLaunch from subscription state and seat count.
 *
 * "use client" — this hook runs in the browser only.
 */

"use client";

import useSWR from "swr";
import type { SubscriptionState } from "@/lib/access/subscriptionGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingStatusResponse {
  subscribed: boolean;
  status: string | null;
  seatCount: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export interface SubscriptionAccess {
  state: SubscriptionState;
  canLaunch: boolean;
  isPastDue: boolean;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  seatCount: number;
  isLoading: boolean;
}

// ─── Trial seat cap (must match subscriptionGuard.ts) ─────────────────────────

const TRIAL_SEAT_CAP = 3;

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetcher(url: string): Promise<BillingStatusResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Billing status fetch failed: ${res.status}`);
  return res.json() as Promise<BillingStatusResponse>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// Permissive defaults — returned when billing check errors or is loading.
// Prevents the subscription overlay from blocking the dashboard when
// Stripe is not yet connected or the JWT is still propagating.
const PERMISSIVE_DEFAULTS: SubscriptionAccess = {
  state: "active",
  canLaunch: true,
  isPastDue: false,
  isTrialing: false,
  trialEndsAt: null,
  seatCount: 0,
  isLoading: false,
};

export function useSubscriptionAccess(): SubscriptionAccess {
  const { data, isLoading, error } = useSWR<BillingStatusResponse>(
    "/api/billing/status",
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      shouldRetryOnError: false, // don't hammer a 401
    }
  );

  // If loading or errored (e.g. Stripe not connected, 401), return permissive defaults
  // so the dashboard is fully accessible. The overlay will only show once Stripe
  // is connected and billing/status returns a real "none" state.
  if (isLoading || error || !data) return { ...PERMISSIVE_DEFAULTS, isLoading };

  // Derive subscription state from status string
  function deriveState(status: string | null | undefined): SubscriptionState {
    if (!status) return "none";
    switch (status) {
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
  }

  const state = deriveState(data.status);
  const seatCount = data.seatCount ?? 0;
  const isTrialing = state === "trialing";
  const isPastDue = state === "past_due";

  // canLaunch: true only for active, or trialing with seats remaining
  const canLaunch =
    state === "active" ||
    (state === "trialing" && seatCount < TRIAL_SEAT_CAP);

  const trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null;

  return {
    state,
    canLaunch,
    isPastDue,
    isTrialing,
    trialEndsAt,
    seatCount,
    isLoading,
  };
}
