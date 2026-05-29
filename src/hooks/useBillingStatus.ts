/**
 * src/hooks/useBillingStatus.ts
 * "use client" — polls GET /api/billing/status every 60 seconds.
 * Returns typed billing state for use in BillingCard and dashboard guard.
 */
"use client";

import { useState, useEffect, useCallback } from "react";

export interface BillingStatus {
  subscribed: boolean;
  status: string | null;
  seatCount: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

interface UseBillingStatusResult {
  billing: BillingStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const DEFAULT_BILLING: BillingStatus = {
  subscribed: false,
  status: null,
  seatCount: 0,
  trialEndsAt: null,
  currentPeriodEnd: null,
};

export function useBillingStatus(): UseBillingStatusResult {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/status");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Failed to fetch billing status");
        setBilling(DEFAULT_BILLING);
        return;
      }
      const data = (await res.json()) as BillingStatus;
      setBilling(data);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      setBilling(DEFAULT_BILLING);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { billing, isLoading, error, refetch: fetchStatus };
}
