"use client";

import { useState, useEffect } from "react";

interface ClientData {
  id: string;
  businessName: string;
  vertical: string;
  status: string;
  dailyBudgetUsd: number;
  leadCount: number;
  appointmentCount: number;
  createdAt: string;
}

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  createdAt: string;
}

interface Representative {
  id: string;
  repName: string;
  personality: string;
}

interface ClientSubAccountProps {
  clientId: string;
  onBack: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function verticalLabel(v: string): string {
  return v
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const LEAD_STATUS: Record<string, { dot: string; label: string }> = {
  new:     { dot: "bg-blue-400",  label: "New" },
  called:  { dot: "bg-amber-400", label: "Called" },
  booked:  { dot: "bg-green-400", label: "Booked" },
  no_show: { dot: "bg-red-400",   label: "No show" },
  default: { dot: "bg-zinc-600",  label: "Unknown" },
};

const CLIENT_STATUS: Record<string, { dot: string; label: string }> = {
  live:       { dot: "bg-green-400",  label: "Live" },
  deploying:  { dot: "bg-blue-400",   label: "Deploying" },
  generating: { dot: "bg-purple-400", label: "Generating" },
  pending:    { dot: "bg-zinc-500",   label: "Pending" },
  paused:     { dot: "bg-amber-400",  label: "Paused" },
  failed:     { dot: "bg-red-400",    label: "Failed" },
  setup:      { dot: "bg-zinc-600",   label: "Setup" },
};

function StatusDot({ status }: { status: string }) {
  const s = CLIENT_STATUS[status.toLowerCase()] ?? { dot: "bg-zinc-600", label: status };
  return (
    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-2)" }}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default function ClientSubAccount({ clientId, onBack }: ClientSubAccountProps): JSX.Element {
  const [client, setClient] = useState<ClientData | null>(null);
  const [leads,  setLeads]  = useState<Lead[]>([]);
  const [rep,    setRep]    = useState<Representative | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/agency/clients")
        .then((r) => r.ok ? r.json() as Promise<{ clients: ClientData[] }> : Promise.resolve({ clients: [] }))
        .then((d) => setClient(d.clients.find((c) => c.id === clientId) ?? null)),
      fetch(`/api/leads?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<Lead[]> : Promise.resolve([]))
        .then((d) => setLeads(Array.isArray(d) ? d : [])),
      fetch(`/api/representative?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<Representative | null> : Promise.resolve(null))
        .then((d) => setRep(d)),
    ]).finally(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: "var(--text-3)" }}>
        Client not found.
      </div>
    );
  }

  const agentName = rep?.repName ?? "Not configured";
  const leadsThisWeek = leads.filter((l) => new Date(l.createdAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-GB", { weekday: "long" });

  const kpis = [
    { label: "Spend today",      value: "£0",                  sub: "Live campaigns" },
    { label: "Leads this week",  value: String(leadsThisWeek), sub: "7-day window" },
    { label: "Booked this week", value: "0",                   sub: "Confirmed appts" },
    { label: "CPL",              value: "—",                   sub: "Cost per lead" },
  ];

  return (
    <div className="space-y-5">
      {/* Back */}
      <button
        onClick={onBack}
        className="text-xs transition-colors"
        style={{ color: "var(--text-3)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-2)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-3)")}
      >
        ← All clients
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0"
            style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)" }}
          >
            {initials(client.businessName)}
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              {client.businessName}
            </h1>
            <div className="flex items-center gap-2.5 mt-1.5">
              <span
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)" }}
              >
                {verticalLabel(client.vertical)}
              </span>
              <StatusDot status={client.status} />
            </div>
          </div>
        </div>

        {/* Agent section */}
        <div
          className="flex items-center gap-3 px-3 py-2 rounded-lg"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: "var(--gold)" }}
          >
            {initials(agentName)}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-3)" }}>
              AI Agent
            </div>
            <div className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
              {agentName}
            </div>
          </div>
        </div>
      </div>

      {/* Morning briefing */}
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--text-3)" }}>
          Morning briefing
        </div>
        <div className="font-mono text-xs mb-2.5" style={{ color: "var(--text-2)" }}>
          {yesterday} · {agentName} · {client.businessName}
        </div>
        <div className="font-mono text-xs space-y-1" style={{ color: "var(--text-3)" }}>
          <div>• Called 0 leads · 0 booked</div>
          <div>• No ad changes made</div>
          <div>• Campaign running within target CPL</div>
        </div>
      </div>

      {/* KPI strip */}
      <div
        className="grid grid-cols-4 rounded-xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className="px-4 py-4"
            style={{ borderRight: i < 3 ? "1px solid var(--border)" : "none" }}
          >
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-3)" }}>
              {k.label}
            </div>
            <div className="text-xl font-medium font-mono tracking-tight" style={{ color: "var(--text-1)" }}>
              {k.value}
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Recent leads */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Recent leads
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {leads.length} total
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-xs" style={{ color: "var(--text-3)" }}>No leads yet</span>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Name", "Phone", "Status", "Time"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium"
                    style={{ color: "var(--text-3)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 20).map((l, i) => {
                const st = LEAD_STATUS[l.status] ?? LEAD_STATUS["default"]!;
                return (
                  <tr
                    key={l.id}
                    style={{ borderBottom: i < Math.min(leads.length, 20) - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: "var(--text-1)" }}>
                      {l.firstName} {l.lastName}
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ color: "var(--text-2)" }}>
                      {l.phone}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                        <span style={{ color: "var(--text-2)" }}>{st.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ color: "var(--text-3)" }}>
                      {timeAgo(l.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
