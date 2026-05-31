/**
 * src/hooks/useBillingStatus.ts
 * "use client" — fetches GET /api/billing/status (tiered seat model).
 */
"use client";

import { useState, useEffect, useCallback } from "react";

export interface BillingClient {
  id:           string;
  businessName: string;
  clientTier:   string;
  status:       string;
}

export interface VolumePricing {
  clientCount:     number;
  perClientGbp:    number;
  platformFeeGbp:  number;
  monthlyTotalGbp: number;
  nextTier: {
    clientsUntil:     number;
    perClientGbp:     number;
    monthlySavingGbp: number;
  } | null;
}

export interface BillingStatus {
  platformActive:   boolean;
  subscribed:       boolean;
  status:           string | null;
  platformFee:      number;
  starterSeats:     number;
  fullServiceSeats: number;
  seatPrices:       { starter: number; full_service: number };
  monthlyTotal:     number;
  volume:           VolumePricing;
  nextBillingDate:  string | null;
  trialEndsAt:      string | null;
  clients:          BillingClient[];
}

interface UseBillingStatusResult {
  billing:   BillingStatus | null;
  isLoading: boolean;
  error:     string | null;
  refetch:   () => void;
}

export function useBillingStatus(): UseBillingStatusResult {
  const [billing,   setBilling]   = useState<BillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/status");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to fetch billing status");
        return;
      }
      const data = (await res.json()) as BillingStatus;
      setBilling(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  return { billing, isLoading, error, refetch: fetchStatus };
}
