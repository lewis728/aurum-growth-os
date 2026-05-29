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

export function useSubscriptionAccess(): SubscriptionAccess {
  const { data, isLoading } = useSWR<BillingStatusResponse>(
    "/api/billing/status",
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      shouldRetryOnError: true,
    }
  );

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

  const state = deriveState(data?.status);
  const seatCount = data?.seatCount ?? 0;
  const isTrialing = state === "trialing";
  const isPastDue = state === "past_due";

  // canLaunch: true only for active, or trialing with seats remaining
  const canLaunch =
    state === "active" ||
    (state === "trialing" && seatCount < TRIAL_SEAT_CAP);

  const trialEndsAt = data?.trialEndsAt ? new Date(data.trialEndsAt) : null;

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
