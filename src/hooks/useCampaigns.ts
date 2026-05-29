"use client";
/**
 * src/hooks/useCampaigns.ts
 * CLIENT-SIDE ONLY. Never import server-only modules here.
 *
 * SWR hook for fetching the authenticated tenant's campaign blueprints.
 * Polls every 60 seconds and revalidates on window focus.
 */

import useSWR from "swr";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetcher(url: string): Promise<CampaignBlueprint[]> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`useCampaigns: ${res.status} — ${text}`);
  }
  return res.json() as Promise<CampaignBlueprint[]>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseCampaignsResult {
  campaigns:  CampaignBlueprint[];
  isLoading:  boolean;
  error:      Error | undefined;
  mutate:     () => void;
}

export function useCampaigns(): UseCampaignsResult {
  const { data, isLoading, error, mutate } = useSWR<CampaignBlueprint[], Error>(
    "/api/campaigns",
    fetcher,
    {
      refreshInterval:    60_000,   // poll every 60 seconds
      revalidateOnFocus:  true,
      dedupingInterval:   5_000,    // deduplicate requests within 5 seconds
      keepPreviousData:   true,
    }
  );

  return {
    campaigns: data ?? [],
    isLoading,
    error,
    mutate,
  };
}
