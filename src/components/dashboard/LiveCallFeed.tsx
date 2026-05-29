"use client";
/**
 * src/components/dashboard/LiveCallFeed.tsx
 *
 * Shows the last 20 AI calls across the agency's client portfolio.
 * Each row shows: client name, lead name, outcome badge, duration, time ago.
 */
import type { RecentCallRow } from "@/app/api/dashboard/metrics/route";

interface LiveCallFeedProps {
  calls:     RecentCallRow[];
  isLoading: boolean;
}

const OUTCOME_BADGE: Record<
  RecentCallRow["outcome"],
  { label: string; className: string }
> = {
  booked:         { label: "Booked",         className: "bg-emerald-100 text-emerald-700" },
  qualified:      { label: "Qualified",      className: "bg-blue-100 text-blue-700" },
  no_answer:      { label: "No Answer",      className: "bg-slate-100 text-slate-600" },
  not_interested: { label: "Not Interested", className: "bg-red-100 text-red-600" },
  unknown:        { label: "Called",         className: "bg-slate-100 text-slate-500" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-[#F3F4F6] animate-pulse">
      <div className="w-8 h-8 rounded-full bg-[#F3F4F6]" />
      <div className="flex-1">
        <div className="h-3 w-32 bg-[#F3F4F6] rounded mb-1.5" />
        <div className="h-2.5 w-20 bg-[#F3F4F6] rounded" />
      </div>
      <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
    </div>
  );
}

export function LiveCallFeed({ calls, isLoading }: LiveCallFeedProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-sm font-semibold text-[#111827]">Live Call Feed</h2>
        </div>
        <span className="text-xs text-[#6B7280]">Last 20 calls · all clients</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[#F3F4F6]">
        {isLoading && calls.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
        ) : calls.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[#6B7280]">No calls recorded yet.</p>
            <p className="text-xs text-[#9CA3AF] mt-1">
              Calls will appear here once your client campaigns go live.
            </p>
          </div>
        ) : (
          calls.map((call) => {
            const badge = OUTCOME_BADGE[call.outcome];
            return (
              <div
                key={call.leadId}
                className="flex items-center gap-3 px-6 py-3 hover:bg-[#FAFAFA] transition-colors"
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-[#F3F4F6] flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-medium text-[#6B7280]">
                    {call.leadName.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Lead + client info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#111827] truncate">
                    {call.leadName}
                  </p>
                  <p className="text-xs text-[#6B7280] truncate">
                    {call.clientName} · {formatDuration(call.durationSeconds)}
                  </p>
                </div>

                {/* Outcome badge */}
                <span
                  className={`
                    inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                    flex-shrink-0
                    ${badge.className}
                  `}
                >
                  {badge.label}
                </span>

                {/* Time ago */}
                <span className="text-xs text-[#9CA3AF] flex-shrink-0 w-14 text-right">
                  {timeAgo(call.completedAt)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
