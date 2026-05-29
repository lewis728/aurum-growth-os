"use client";
/**
 * src/components/dashboard/ClientOverview.tsx
 *
 * Table of all agency clients (CampaignBlueprint rows) with summary stats.
 * Fetches from GET /api/agency/clients.
 *
 * Columns: Client Name · Vertical · Status · Daily Budget · Leads · Appointments
 *
 * Design: white background, Aurum gold accent, Inter font.
 * Agency-owner framing — "your clients", "your client campaigns".
 */

import { useState, useEffect } from "react";
import type { ClientSummary } from "@/app/api/agency/clients/route";

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, string> = {
  live:       "bg-green-50 text-green-700",
  deploying:  "bg-blue-50 text-blue-700",
  generating: "bg-purple-50 text-purple-700",
  pending:    "bg-gray-50 text-gray-600",
  paused:     "bg-amber-50 text-amber-700",
  failed:     "bg-red-50 text-red-700",
  archived:   "bg-gray-50 text-gray-400",
};

function StatusBadge({ status }: { status: string }): JSX.Element {
  const style = STATUS_STYLES[status.toLowerCase()] ?? "bg-gray-50 text-gray-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status}
    </span>
  );
}

// ── Vertical label ────────────────────────────────────────────────────────────
function verticalLabel(v: string): string {
  return v
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ClientOverview(): JSX.Element {
  const [clients,  setClients]  = useState<ClientSummary[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch("/api/agency/clients");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { clients: ClientSummary[] };
        setClients(data.clients);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load clients.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
        {error}
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (clients.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-[#FAFAF9] px-6 py-12 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ backgroundColor: "#C9A84C1A" }}
        >
          <svg
            className="h-6 w-6"
            style={{ color: "#C9A84C" }}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-[#111827]">No clients yet</p>
        <p className="mt-1 text-xs text-[#6B7280]">
          Complete the onboarding flow to add your first client campaign.
        </p>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-[#FAFAF9]">
          <tr>
            {[
              "Client Name",
              "Vertical",
              "Status",
              "Daily Budget",
              "Leads",
              "Appointments",
            ].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wide whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 bg-white">
          {clients.map((c) => (
            <tr key={c.id} className="hover:bg-[#FAFAF9] transition-colors">
              <td className="px-4 py-3 font-medium text-[#111827] whitespace-nowrap">
                {c.businessName}
              </td>
              <td className="px-4 py-3 text-[#374151] whitespace-nowrap">
                {verticalLabel(c.vertical)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={c.status} />
              </td>
              <td className="px-4 py-3 text-[#374151] whitespace-nowrap">
                £{c.dailyBudgetUsd.toFixed(2)}
                <span className="text-xs text-[#9CA3AF]">/day</span>
              </td>
              <td className="px-4 py-3 text-[#374151]">
                <span className="font-semibold text-[#111827]">{c.leadCount}</span>
              </td>
              <td className="px-4 py-3 text-[#374151]">
                <span className="font-semibold text-[#111827]">
                  {c.appointmentCount}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
