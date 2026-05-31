"use client";

/**
 * TeamActivityFeed — the unified, chronological feed of what the whole AI team did
 * (Sprint 3C). Last 20 AgentActions interleaved, each with the acting agent's
 * coloured initial avatar + name + plain-English action + time ago. Reads the
 * existing GET /api/agent/actions?blueprintId=… endpoint.
 *
 * Colour is derived from the agentName so caller/scheduler/mediaBuyer/reporter
 * each read in their own colour, matching the TeamStrip cards.
 */

import { useState, useEffect } from "react";

interface AgentAction {
  id:         string;
  agentName:  string;
  actionType: string;
  reasoning:  string;
  outcome:    string;
  executedAt: string;
}

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";

// Known role names → accent. Anything else (the caller uses the configured rep
// name) falls back to gold, since the caller is the only rep-named agent.
function accentFor(agentName: string): string {
  switch (agentName) {
    case "Marcus":         return "#C9A84C"; // media buyer
    case "Ava":            return "#a855f7"; // reporter
    case "James":          return "#3b82f6"; // scheduler
    case "Kai":            return "#64748b"; // learner
    case "Chief of Staff": return "#ef4444"; // portfolio
    default:               return "#22c55e"; // caller (rep name) / Sophie
  }
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TeamActivityFeed({ blueprintId }: { blueprintId: string }) {
  const [actions, setActions] = useState<AgentAction[]>([]);

  useEffect(() => {
    fetch(`/api/agent/actions?blueprintId=${encodeURIComponent(blueprintId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ actions: AgentAction[] }>) : Promise.resolve({ actions: [] })))
      .then((d) => setActions(d.actions ?? []))
      .catch(() => setActions([]));
  }, [blueprintId]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Team activity</div>
        <div className="text-[11px]" style={{ color: "var(--text-3)" }}>Everything your team did</div>
      </div>

      {actions.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <span className="text-xs" style={{ color: "var(--text-3)" }}>No activity yet</span>
        </div>
      ) : (
        <div className="flex flex-col">
          {actions.map((a, i) => {
            const accent = accentFor(a.agentName);
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 px-4 py-3"
                style={{ borderBottom: i < actions.length - 1 ? "1px solid var(--border)" : "none" }}
              >
                <div style={{
                  width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
                  background: `${accent}22`, color: accent,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "11px", fontWeight: 700,
                }}>
                  {a.agentName.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="text-[13px]" style={{ color: "var(--text-1)", lineHeight: 1.45 }}>
                    <span style={{ color: accent, fontWeight: 600 }}>{a.agentName}: </span>
                    {a.reasoning}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-3)", fontFamily: mono }}>
                    {a.outcome} · {timeAgo(a.executedAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
