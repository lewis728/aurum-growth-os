"use client";
/**
 * src/hooks/useDashboardMetrics.ts
 * CLIENT-SIDE ONLY. Never import server-only modules here.
 *
 * SWR hook for fetching the Fortune 500 Client Dashboard metrics.
 * Polls every 30 seconds and revalidates on window focus.
 * Accepts an optional blueprintId to filter to a single client.
 */
import useSWR from "swr";
import type {
  DashboardMetricsResponse,
} from "@/app/api/dashboard/metrics/route";

export type { DashboardMetricsResponse };

async function fetcher(url: string): Promise<DashboardMetricsResponse> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`useDashboardMetrics: ${res.status} — ${text}`);
  }
  return res.json() as Promise<DashboardMetricsResponse>;
}

interface UseDashboardMetricsResult {
  data:      DashboardMetricsResponse | undefined;
  isLoading: boolean;
  error:     Error | undefined;
  mutate:    () => void;
}

export function useDashboardMetrics(
  blueprintId?: string
): UseDashboardMetricsResult {
  const url = blueprintId
    ? `/api/dashboard/metrics?blueprintId=${encodeURIComponent(blueprintId)}`
    : "/api/dashboard/metrics";

  const { data, isLoading, error, mutate } = useSWR<
    DashboardMetricsResponse,
    Error
  >(url, fetcher, {
    refreshInterval:   30_000,
    revalidateOnFocus: true,
    dedupingInterval:  5_000,
    keepPreviousData:  true,
  });

  return { data, isLoading, error, mutate };
}
