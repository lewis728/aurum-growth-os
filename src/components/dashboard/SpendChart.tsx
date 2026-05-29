"use client";
/**
 * src/components/dashboard/SpendChart.tsx
 *
 * 7-day spend bar chart using only CSS — no external chart library.
 * Each bar represents one day's total spend across all active client campaigns.
 * Gold bar for the current day, slate for past days.
 */
import type { SpendChartPoint } from "@/app/api/dashboard/metrics/route";

interface SpendChartProps {
  days:      SpendChartPoint[];
  isLoading: boolean;
}

function SkeletonBar() {
  return (
    <div className="flex flex-col items-center gap-1 flex-1 animate-pulse">
      <div className="w-full rounded-t-md bg-[#F3F4F6]" style={{ height: "60%" }} />
      <div className="h-2.5 w-8 bg-[#F3F4F6] rounded" />
    </div>
  );
}

export function SpendChart({ days, isLoading }: SpendChartProps) {
  const maxSpend = days.length > 0 ? Math.max(...days.map((d) => d.spendGbp), 1) : 1;
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
        <h2 className="text-sm font-semibold text-[#111827]">7-Day Spend</h2>
        <span className="text-xs text-[#6B7280]">All client campaigns combined</span>
      </div>

      {/* Chart */}
      <div className="px-6 py-5">
        {isLoading && days.length === 0 ? (
          <div className="flex items-end gap-2 h-32">
            {Array.from({ length: 7 }).map((_, i) => (
              <SkeletonBar key={i} />
            ))}
          </div>
        ) : days.length === 0 ? (
          <div className="h-32 flex items-center justify-center">
            <p className="text-sm text-[#6B7280]">No spend data yet.</p>
          </div>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {days.map((day) => {
              const heightPct = maxSpend > 0 ? (day.spendGbp / maxSpend) * 100 : 0;
              const isToday   = day.date === todayIso;
              const shortLabel = new Date(day.date).toLocaleDateString("en-GB", {
                weekday: "short",
              });
              return (
                <div
                  key={day.date}
                  className="flex flex-col items-center gap-1 flex-1 group relative"
                >
                  {/* Tooltip */}
                  <div className="
                    absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                    bg-[#111827] text-white text-xs rounded px-2 py-1
                    opacity-0 group-hover:opacity-100 transition-opacity
                    pointer-events-none whitespace-nowrap z-10
                  ">
                    £{day.spendGbp.toFixed(0)}
                  </div>

                  {/* Bar */}
                  <div className="w-full flex items-end" style={{ height: "108px" }}>
                    <div
                      className={`
                        w-full rounded-t-md transition-all duration-300
                        ${isToday ? "bg-[#C9A84C]" : "bg-[#E5E7EB] hover:bg-[#D1D5DB]"}
                      `}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                  </div>

                  {/* Day label */}
                  <span
                    className={`text-xs ${isToday ? "text-[#C9A84C] font-semibold" : "text-[#9CA3AF]"}`}
                  >
                    {shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Y-axis hint */}
        {days.length > 0 && (
          <div className="flex justify-between mt-3 border-t border-[#F3F4F6] pt-2">
            <span className="text-xs text-[#9CA3AF]">£0</span>
            <span className="text-xs text-[#9CA3AF]">
              Max £{maxSpend.toFixed(0)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
