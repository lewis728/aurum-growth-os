"use client";
/**
 * src/components/dashboard/ClientSelector.tsx
 *
 * Dropdown that lets the agency owner switch between "All Clients" (aggregate
 * view) and any individual client campaign. Drives the blueprintId state that
 * is passed to useDashboardMetrics.
 *
 * NOTE: The Prisma CampaignBlueprint model uses `id` (not `blueprintId`) and
 * `businessName` (not `pipelineId`). The CampaignBlueprint TypeScript type uses
 * `blueprintId`, but the raw DB rows returned by GET /api/campaigns use `id`.
 * We cast to `any[]` here to handle both shapes safely.
 */
import { useCampaigns } from "@/hooks/useCampaigns";

interface ClientSelectorProps {
  selectedBlueprintId: string | undefined;
  onChange: (blueprintId: string | undefined) => void;
}

export function ClientSelector({
  selectedBlueprintId,
  onChange,
}: ClientSelectorProps) {
  const { campaigns, isLoading } = useCampaigns();

  return (
    <div className="relative inline-block">
      <select
        value={selectedBlueprintId ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : e.target.value)
        }
        disabled={isLoading}
        className="
          appearance-none
          bg-white border border-[#E5E7EB] rounded-lg
          pl-4 pr-10 py-2.5
          text-sm font-medium text-[#111827]
          shadow-sm
          focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40 focus:border-[#C9A84C]
          disabled:opacity-50 disabled:cursor-not-allowed
          cursor-pointer
          min-w-[180px]
        "
      >
        <option value="">All Clients</option>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {(campaigns as any[]).map((c) => {
          // Prisma returns `id`; the TS type uses `blueprintId` — handle both
          const id    = (c.id ?? c.blueprintId ?? "") as string;
          const label = (c.businessName ?? `Client ${id.slice(-6)}`) as string;
          return (
            <option key={id} value={id}>
              {label}
            </option>
          );
        })}
      </select>
      {/* Chevron icon */}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 5l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
