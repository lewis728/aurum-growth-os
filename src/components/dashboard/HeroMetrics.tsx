"use client";
/**
 * src/components/dashboard/HeroMetrics.tsx
 *
 * Four KPI tiles: Spend Today, Leads Today, CPL This Week, Booked This Week.
 * All figures are agency-scoped — they reflect the selected client or all clients.
 */
import type { HeroMetrics as HeroMetricsData } from "@/app/api/dashboard/metrics/route";

interface HeroMetricsProps {
  data:      HeroMetricsData | undefined;
  isLoading: boolean;
  clientName?: string;  // undefined = "All Clients"
}

function SkeletonTile() {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-6 shadow-sm animate-pulse">
      <div className="h-3 w-24 bg-[#F3F4F6] rounded mb-4" />
      <div className="h-8 w-20 bg-[#F3F4F6] rounded mb-2" />
      <div className="h-3 w-16 bg-[#F3F4F6] rounded" />
    </div>
  );
}

interface TileProps {
  label:    string;
  value:    string;
  subtext?: string;
  accent?:  boolean;
  trend?:   "up" | "down" | "neutral";
}

function Tile({ label, value, subtext, accent, trend }: TileProps) {
  const trendColour =
    trend === "up"   ? "text-emerald-600" :
    trend === "down" ? "text-red-500"     :
    "text-[#6B7280]";

  return (
    <div
      className={`
        bg-white rounded-2xl border p-6 shadow-sm
        ${accent ? "border-[#C9A84C]/30" : "border-[#E5E7EB]"}
      `}
    >
      <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wider mb-3">
        {label}
      </p>
      <p className={`text-3xl font-bold ${accent ? "text-[#C9A84C]" : "text-[#111827]"}`}>
        {value}
      </p>
      {subtext && (
        <p className={`text-xs mt-1.5 ${trendColour}`}>{subtext}</p>
      )}
    </div>
  );
}

export function HeroMetrics({ data, isLoading, clientName }: HeroMetricsProps) {
  const scope = clientName ? `${clientName}` : "All clients";

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </div>
    );
  }

  const m = data;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Tile
        label="Spend Today"
        value={m ? `£${m.spendToday.toFixed(0)}` : "—"}
        subtext={`${scope} · live campaigns`}
      />
      <Tile
        label="Leads Today"
        value={m ? String(m.leadsToday) : "—"}
        subtext={`${scope}`}
        trend={m && m.leadsToday > 0 ? "up" : "neutral"}
      />
      <Tile
        label="CPL This Week"
        value={m ? `£${m.cplThisWeek.toFixed(2)}` : "—"}
        subtext={`${scope} · 7-day average`}
        accent
      />
      <Tile
        label="Booked This Week"
        value={m ? String(m.bookedThisWeek) : "—"}
        subtext={`${scope} · confirmed appointments`}
        trend={m && m.bookedThisWeek > 0 ? "up" : "neutral"}
      />
    </div>
  );
}
