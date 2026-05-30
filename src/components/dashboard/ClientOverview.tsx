"use client";

import { useState, useEffect } from "react";
import type { ClientSummary } from "@/app/api/agency/clients/route";

const STATUS_STYLES: Record<string, string> = {
  live:       "bg-green-950/50 text-green-400",
  deploying:  "bg-blue-950/50 text-blue-400",
  generating: "bg-purple-950/50 text-purple-400",
  pending:    "bg-zinc-900 text-zinc-500",
  paused:     "bg-amber-950/50 text-amber-400",
  failed:     "bg-red-950/50 text-red-400",
  archived:   "bg-zinc-900 text-zinc-600",
};

function StatusBadge({ status }: { status: string }): JSX.Element {
  const style = STATUS_STYLES[status.toLowerCase()] ?? "bg-zinc-900 text-zinc-500";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {status}
    </span>
  );
}

function verticalLabel(v: string): string {
  return v
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "var(--red)" }}>
        {error}
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-xl px-6 py-12 text-center" style={{ border: "1px dashed var(--border-strong)", background: "var(--surface-1)" }}>
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
          style={{ background: "var(--gold-muted)" }}
        >
          <svg
            className="h-6 w-6"
            style={{ color: "var(--gold)" }}
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
        <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>No clients yet</p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>
          Complete the onboarding flow to add your first client campaign.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--border)" }}>
      <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
        <thead style={{ background: "var(--surface-2)" }}>
          <tr>
            {["Client Name", "Vertical", "Status", "Daily Budget", "Leads", "Appointments"].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                style={{ color: "var(--text-3)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ background: "var(--surface-1)" }}>
          {clients.map((c, i) => (
            <tr
              key={c.id}
              className="transition-colors"
              style={{
                borderTop: i > 0 ? "1px solid var(--border)" : "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-1)")}
            >
              <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "var(--text-1)" }}>
                {c.businessName}
              </td>
              <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--text-2)" }}>
                {verticalLabel(c.vertical)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={c.status} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap font-mono" style={{ color: "var(--text-2)" }}>
                £{c.dailyBudgetUsd.toFixed(2)}
                <span className="text-xs" style={{ color: "var(--text-3)" }}>/day</span>
              </td>
              <td className="px-4 py-3">
                <span className="font-semibold font-mono" style={{ color: "var(--text-1)" }}>{c.leadCount}</span>
              </td>
              <td className="px-4 py-3">
                <span className="font-semibold font-mono" style={{ color: "var(--text-1)" }}>{c.appointmentCount}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
