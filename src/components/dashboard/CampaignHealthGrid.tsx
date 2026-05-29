"use client";
/**
 * src/components/dashboard/CampaignHealthGrid.tsx
 *
 * Table showing per-client campaign health across the agency portfolio.
 * Columns: Client, Vertical, Status, Daily Budget, Spend Today, CPL, CTR, Leads/Week.
 */
import type { CampaignHealthRow } from "@/app/api/dashboard/metrics/route";

interface CampaignHealthGridProps {
  rows:      CampaignHealthRow[];
  isLoading: boolean;
  onSelectClient?: (blueprintId: string) => void;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  LIVE:     { label: "Live",     className: "bg-emerald-100 text-emerald-700" },
  PAUSED:   { label: "Paused",   className: "bg-amber-100 text-amber-700" },
  PENDING:  { label: "Pending",  className: "bg-slate-100 text-slate-600" },
  FAILED:   { label: "Failed",   className: "bg-red-100 text-red-600" },
  ARCHIVED: { label: "Archived", className: "bg-slate-100 text-slate-400" },
};

function cplColour(cpl: number): string {
  if (cpl === 0)   return "text-[#9CA3AF]";
  if (cpl <= 25)   return "text-emerald-600 font-semibold";
  if (cpl <= 35)   return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

function ctrColour(ctr: number): string {
  if (ctr === 0)   return "text-[#9CA3AF]";
  if (ctr >= 2)    return "text-emerald-600";
  if (ctr >= 1)    return "text-amber-600";
  return "text-red-600";
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-[#F3F4F6]">
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-[#F3F4F6] rounded w-full max-w-[80px]" />
        </td>
      ))}
    </tr>
  );
}

export function CampaignHealthGrid({
  rows,
  isLoading,
  onSelectClient,
}: CampaignHealthGridProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
        <h2 className="text-sm font-semibold text-[#111827]">Client Campaign Health</h2>
        <span className="text-xs text-[#6B7280]">
          CPL benchmark: £35 · CTR target: 2%+
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#F3F4F6] bg-[#FAFAFA]">
              <th className="text-left px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                Client
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                Vertical
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                Status
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                Daily Budget
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                Spend Today
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                CPL
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                CTR
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-[#6B7280] uppercase tracking-wider">
                Leads/Wk
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center">
                  <p className="text-sm text-[#6B7280]">No client campaigns yet.</p>
                  <p className="text-xs text-[#9CA3AF] mt-1">
                    Launch your first client campaign from the Command tab.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const badge =
                  STATUS_BADGE[row.status] ??
                  { label: row.status, className: "bg-slate-100 text-slate-500" };

                return (
                  <tr
                    key={row.blueprintId}
                    className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                    onClick={() => onSelectClient?.(row.blueprintId)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#111827] truncate max-w-[140px]">
                        {row.displayName}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#6B7280] text-xs truncate max-w-[100px]">
                        {row.vertical.replace(/_/g, " ")}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`
                          inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                          ${badge.className}
                        `}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[#111827]">
                      £{row.dailyBudgetGbp.toFixed(0)}
                    </td>
                    <td className="px-4 py-3 text-right text-[#6B7280]">
                      {row.spendToday > 0 ? `£${row.spendToday.toFixed(0)}` : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right ${cplColour(row.cplThisWeek)}`}>
                      {row.cplThisWeek > 0 ? `£${row.cplThisWeek.toFixed(2)}` : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right ${ctrColour(row.ctr)}`}>
                      {row.ctr > 0 ? `${row.ctr.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[#111827]">
                      {row.leadsThisWeek}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
