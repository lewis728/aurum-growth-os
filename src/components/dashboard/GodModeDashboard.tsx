"use client";

/**
 * God Mode — the agency owner's command centre.
 * One screen: Business Manager briefing → top KPI strip → flagged clients →
 * full portfolio table. Reads /api/dashboard/overview, auto-refreshes every 30s.
 *
 * Design: premium dark glass per CLAUDE.md — var(--surface-*), var(--border),
 * var(--gold); JetBrains Mono for numbers; coloured status dots, never badges.
 *
 * Note: the per-client deep view lives in the main dashboard's component state
 * (selectedClientId), not a route, so portfolio rows are read-only here — they
 * never link to a non-existent /client/:id page. A back link returns to it.
 */

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to load");
    return r.json();
  });

interface LastAction { actionType: string; reasoning: string; agentName: string; executedAt: string }
interface PortfolioRow {
  blueprintId: string; businessName: string; agentName: string | null; status: string;
  leadsToday: number; bookedToday: number; revenueThisMonthGbp: number | null; lastAction: LastAction | null;
}
interface FlaggedClient { blueprintId: string; businessName: string; reason: string; recommended: string; flaggedAt: string }
interface Overview {
  topStrip: { leadsToday: number; bookedToday: number; revenueThisMonthGbp: number; activeCampaigns: number; pipelineValueGbp: number };
  briefing: { text: string; generatedAt: string } | null;
  flagged:  FlaggedClient[];
  clients:  PortfolioRow[];
  pendingApprovals: number;
}

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";

function statusColor(status: string): string {
  switch (status) {
    case "live":   return "#22c55e";
    case "paused": return "#f59e0b";
    case "failed": return "#ef4444";
    default:       return "var(--text-3, #52525b)";
  }
}
function gbp(n: number): string { return `£${n.toLocaleString("en-GB")}`; }
function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function GodModeDashboard() {
  const { data, isLoading } = useSWR<Overview>("/api/dashboard/overview", fetcher, { refreshInterval: 30_000 });

  const top = data?.topStrip ?? { leadsToday: 0, bookedToday: 0, revenueThisMonthGbp: 0, activeCampaigns: 0, pipelineValueGbp: 0 };
  const clients  = data?.clients  ?? [];
  const flagged  = data?.flagged  ?? [];
  const briefing = data?.briefing ?? null;
  const pendingApprovals = data?.pendingApprovals ?? 0;

  const kpis = [
    { label: "Leads today",        value: String(top.leadsToday) },
    { label: "Booked today",       value: String(top.bookedToday) },
    { label: "Revenue this month", value: gbp(top.revenueThisMonthGbp) },
    { label: "Pipeline value",     value: gbp(top.pipelineValueGbp) },
    { label: "Active campaigns",   value: String(top.activeCampaigns) },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #000)" }}>
      <nav style={{
        borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))", padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-1, #fff)" }}>Aurum Growth</span>
          <span style={{ fontSize: "13px", color: "var(--text-3, #52525b)" }}>God Mode</span>
        </div>
        <Link href="/" style={{ fontSize: "13px", color: "var(--text-2, #a1a1aa)", textDecoration: "none" }}>
          ← Dashboard
        </Link>
      </nav>

      <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto" }}>
        {/* Business Manager briefing */}
        <section style={{
          background: "var(--surface-1, #0a0a0a)", border: "1px solid var(--border, rgba(255,255,255,0.06))",
          borderRadius: "8px", padding: "24px", marginBottom: "24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--gold, #C9A84C)" }} />
            <span style={{ fontSize: "13px", color: "var(--text-2, #a1a1aa)", fontWeight: 600, letterSpacing: "0.02em" }}>
              YOUR BUSINESS MANAGER
            </span>
            {briefing && (
              <span style={{ fontSize: "12px", color: "var(--text-3, #52525b)", marginLeft: "auto" }}>
                {timeAgo(briefing.generatedAt)}
              </span>
            )}
          </div>
          <p style={{ fontSize: "15px", lineHeight: 1.6, color: "var(--text-1, #fff)", margin: 0, whiteSpace: "pre-wrap" }}>
            {briefing?.text
              ?? "Your Chief of Staff hasn't filed a briefing yet. Once your clients are live and the portfolio check has run, your summary appears here — what's performing, what needs attention, and what to focus on today."}
          </p>
        </section>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "16px", marginBottom: "24px" }}>
          {kpis.map((k) => (
            <div key={k.label} style={{
              background: "var(--surface-1, #0a0a0a)", border: "1px solid var(--border, rgba(255,255,255,0.06))",
              borderRadius: "8px", padding: "20px",
            }}>
              <div style={{ fontSize: "13px", color: "var(--text-2, #a1a1aa)", marginBottom: "8px" }}>{k.label}</div>
              <div style={{ fontSize: "28px", fontWeight: 600, color: "var(--text-1, #fff)", fontFamily: mono }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Pending client-message approvals (Sprint 9) */}
        {pendingApprovals > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px",
            background: "var(--surface-1, #0a0a0a)", border: "1px solid rgba(201,168,76,0.4)",
            borderRadius: "8px", padding: "14px 16px",
          }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--gold, #C9A84C)" }} />
            <span style={{ fontSize: "14px", color: "var(--text-1, #fff)" }}>
              <strong style={{ fontFamily: mono }}>{pendingApprovals}</strong> client {pendingApprovals === 1 ? "reply is" : "replies are"} awaiting your approval
            </span>
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-3, #52525b)" }}>
              open a client to review
            </span>
          </div>
        )}

        {/* Flagged clients */}
        {flagged.length > 0 && (
          <section style={{ marginBottom: "24px" }}>
            <h2 style={{ fontSize: "14px", color: "var(--text-2, #a1a1aa)", margin: "0 0 12px", fontWeight: 600 }}>Needs attention</h2>
            <div style={{ display: "grid", gap: "12px" }}>
              {flagged.map((f) => (
                <div key={f.blueprintId} style={{
                  background: "var(--surface-1, #0a0a0a)", border: "1px solid rgba(239,68,68,0.35)",
                  borderRadius: "8px", padding: "16px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }} />
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-1, #fff)" }}>{f.businessName}</span>
                    <span style={{ fontSize: "12px", color: "var(--text-3, #52525b)", marginLeft: "auto" }}>{timeAgo(f.flaggedAt)}</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-2, #a1a1aa)", marginBottom: "4px" }}>{f.reason}</div>
                  <div style={{ fontSize: "13px", color: "var(--gold, #C9A84C)" }}>→ {f.recommended}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Portfolio table */}
        <section>
          <h2 style={{ fontSize: "14px", color: "var(--text-2, #a1a1aa)", margin: "0 0 12px", fontWeight: 600 }}>Portfolio</h2>
          <div style={{
            background: "var(--surface-1, #0a0a0a)", border: "1px solid var(--border, rgba(255,255,255,0.06))",
            borderRadius: "8px", overflow: "hidden",
          }}>
            <div style={{
              display: "grid", gridTemplateColumns: "2fr 0.7fr 0.7fr 1fr 2.4fr", gap: "12px",
              padding: "12px 16px", borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))",
              fontSize: "12px", color: "var(--text-3, #52525b)", fontWeight: 600,
            }}>
              <div>Client</div>
              <div style={{ textAlign: "right" }}>Leads today</div>
              <div style={{ textAlign: "right" }}>Booked</div>
              <div style={{ textAlign: "right" }}>Revenue (mo)</div>
              <div>Last action</div>
            </div>

            {isLoading && clients.length === 0 && (
              <div style={{ padding: "24px 16px", fontSize: "14px", color: "var(--text-3, #52525b)" }}>Loading portfolio…</div>
            )}
            {!isLoading && clients.length === 0 && (
              <div style={{ padding: "24px 16px", fontSize: "14px", color: "var(--text-3, #52525b)" }}>
                No clients yet. Add your first client to deploy a dedicated AI team.
              </div>
            )}

            {clients.map((c) => (
              <div key={c.blueprintId} style={{
                display: "grid", gridTemplateColumns: "2fr 0.7fr 0.7fr 1fr 2.4fr", gap: "12px",
                padding: "14px 16px", alignItems: "center", borderBottom: "1px solid var(--border, rgba(255,255,255,0.06))",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: statusColor(c.status), flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "14px", color: "var(--text-1, #fff)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.businessName}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-3, #52525b)" }}>{c.agentName ?? "No agent"}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: "15px", color: "var(--text-1, #fff)" }}>{c.leadsToday}</div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: "15px", color: "var(--text-1, #fff)" }}>{c.bookedToday}</div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: "15px", color: c.revenueThisMonthGbp != null ? "var(--text-1, #fff)" : "var(--text-3, #52525b)" }}>
                  {c.revenueThisMonthGbp != null ? gbp(c.revenueThisMonthGbp) : "—"}
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-2, #a1a1aa)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.lastAction
                    ? <span><span style={{ color: "var(--text-3, #52525b)" }}>{c.lastAction.agentName}: </span>{c.lastAction.reasoning}</span>
                    : <span style={{ color: "var(--text-3, #52525b)" }}>No activity yet</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
