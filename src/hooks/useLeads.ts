"use client";
/**
 * src/hooks/useLeads.ts
 * CLIENT-SIDE ONLY. Never import server-only modules here.
 *
 * SWR hook for fetching leads for a specific campaign blueprint.
 * Only fetches when blueprintId is provided (conditional SWR key).
 * Polls every 10 seconds for real-time lead updates.
 */

import useSWR from "swr";
import type { BlueprintLead } from "@/types/campaignBlueprint";

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetcher(url: string): Promise<BlueprintLead[]> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`useLeads: ${res.status} — ${text}`);
  }
  return res.json() as Promise<BlueprintLead[]>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseLeadsResult {
  leads:     BlueprintLead[];
  isLoading: boolean;
  error:     Error | undefined;
}

/**
 * Fetches leads for a given blueprintId.
 * Passing null or undefined disables fetching (conditional SWR key pattern).
 */
export function useLeads(blueprintId: string | null | undefined): UseLeadsResult {
  // Conditional SWR key — null disables the request
  const key = blueprintId ? `/api/leads?blueprintId=${encodeURIComponent(blueprintId)}` : null;

  const { data, isLoading, error } = useSWR<BlueprintLead[], Error>(
    key,
    fetcher,
    {
      refreshInterval:   10_000,   // poll every 10 seconds
      revalidateOnFocus: true,
      dedupingInterval:  2_000,
      keepPreviousData:  true,
    }
  );

  return {
    leads:     data ?? [],
    isLoading: isLoading && !!blueprintId,
    error,
  };
}
