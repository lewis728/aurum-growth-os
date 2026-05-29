"use client";
/**
 * src/components/dashboard/LeadDesk.tsx
 * Real-time inbox for inbound leads and call activity.
 * Data fetched via useLeads(blueprintId) SWR hook (10s poll).
 * Supports filter by status and search by name.
 *
 * CLIENT-SIDE ONLY. Never import Prisma, OpenAI, Twilio, or Retell here.
 */
import { useState, useMemo } from "react";
import { useLeads }          from "@/hooks/useLeads";
import { useChatStore }      from "@/stores/chatStore";
import type { BlueprintLead } from "@/types/campaignBlueprint";

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  new:       { label: "New",       classes: "bg-blue-50 text-blue-700 border-blue-100" },
  called:    { label: "Called",    classes: "bg-purple-50 text-purple-700 border-purple-100" },
  qualified: { label: "Qualified", classes: "bg-amber-50 text-amber-700 border-amber-100" },
  no_answer: { label: "No answer", classes: "bg-gray-50 text-gray-500 border-gray-100" },
  booked:    { label: "Booked",    classes: "bg-green-50 text-green-700 border-green-100" },
  attended:  { label: "Attended",  classes: "bg-teal-50 text-teal-700 border-teal-100" },
  lost:      { label: "Lost",      classes: "bg-red-50 text-red-600 border-red-100" },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, -4).replace(/\d/g, "•")}${phone.slice(-4)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function LeadStatusBadge({ status }: { status: string }): JSX.Element {
  const cfg = STATUS_CONFIG[status] ?? { label: status, classes: "bg-gray-50 text-gray-600 border-gray-100" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

function SkeletonRow(): JSX.Element {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-3.5 bg-gray-100 rounded w-28" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-gray-100 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-3.5 bg-gray-100 rounded w-16" /></td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LeadDesk(): JSX.Element {
  const activeBlueprintId = useChatStore((s) => s.activeBlueprintId);
  const { leads, isLoading, error } = useLeads(activeBlueprintId);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery,  setSearchQuery]  = useState("");

  // Filtered + searched leads
  const filteredLeads = useMemo<BlueprintLead[]>(() => {
    let result = leads;
    if (statusFilter !== "all") {
      result = result.filter((l) => l.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l) =>
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q)
      );
    }
    return result;
  }, [leads, statusFilter, searchQuery]);

  // Status counts for filter chips
  const statusCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = { all: leads.length };
    for (const lead of leads) {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    }
    return counts;
  }, [leads]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Client Bookings</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {activeBlueprintId
              ? isLoading
                ? "Loading leads…"
                : `${leads.length} lead${leads.length !== 1 ? "s" : ""} · auto-refreshes every 10s`
              : "Launch a campaign to see leads here"}
          </p>
        </div>
      </div>

      {/* Filters */}
      {activeBlueprintId && (
        <div className="px-5 py-3 border-b border-gray-50 space-y-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name…"
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-amber-300 focus:ring-1 focus:ring-amber-100 transition-all placeholder-gray-400"
            />
          </div>

          {/* Status filter chips */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setStatusFilter("all")}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                statusFilter === "all"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              All ({statusCounts.all ?? 0})
            </button>
            {ALL_STATUSES.filter((s) => (statusCounts[s] ?? 0) > 0).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  statusFilter === s
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                {STATUS_CONFIG[s]?.label ?? s} ({statusCounts[s] ?? 0})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">
        {/* No campaign selected */}
        {!activeBlueprintId && (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center mb-3">
              <svg className="w-5 h-5" style={{ color: "#C9A84C" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">No campaign selected</p>
            <p className="text-xs text-gray-400 mt-1 max-w-xs">
              Launch a campaign from the Command Centre to start tracking your client bookings.
            </p>
          </div>
        )}

        {/* Loading */}
        {activeBlueprintId && isLoading && (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-xs font-medium text-gray-400">Name</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400">Phone</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400">Created</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400">Appointment</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        )}

        {/* Fetch error */}
        {activeBlueprintId && !isLoading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-gray-900">Could not load leads</p>
            <p className="text-xs text-gray-400 mt-1">{error.message}</p>
          </div>
        )}

        {/* Empty state after filtering */}
        {activeBlueprintId && !isLoading && !error && filteredLeads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-gray-900">
              {leads.length === 0 ? "No leads yet" : "No leads match your filter"}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {leads.length === 0
                ? "Leads will appear here as your campaign generates them."
                : "Try a different status filter or clear the search."}
            </p>
          </div>
        )}

        {/* Leads table */}
        {activeBlueprintId && !isLoading && !error && filteredLeads.length > 0 && (
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-white border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 whitespace-nowrap">Name</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 whitespace-nowrap">Phone</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 whitespace-nowrap">Created</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-400 whitespace-nowrap">Appointment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">
                      {lead.firstName} {lead.lastName}
                    </p>
                    {lead.email && (
                      <p className="text-xs text-gray-400 truncate max-w-[160px]">{lead.email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-gray-600 font-mono">{maskPhone(lead.phone)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-gray-500 whitespace-nowrap">{formatDateTime(lead.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs text-gray-400">
                      {lead.status === "booked" || lead.status === "attended"
                        ? "Scheduled"
                        : "—"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
