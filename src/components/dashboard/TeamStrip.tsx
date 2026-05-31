"use client";

/**
 * TeamStrip — the client's 5-person AI team (Sprint 3C), shown above the pipeline
 * in the client sub-account. Five role cards; each shows the role + agent name, a
 * status dot (green = acted in the last 24h, grey = idle), the last action it took,
 * and a "last active" timestamp. Reads /api/clients/[id]/team.
 *
 * Design: premium dark glass, per-role accent colour, JetBrains Mono timestamps,
 * subtle hover lift. Real avatars later — coloured circle with the role initial.
 */

import { useState, useEffect } from "react";

interface TeamMember {
  role:         string;
  roleLabel:    string;
  agentName:    string;
  lastAction:   string | null;
  lastActiveAt: string | null;
}

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";
const ACCENT: Record<string, string> = {
  caller:     "#22c55e",
  scheduler:  "#3b82f6",
  mediaBuyer: "#C9A84C",
  reporter:   "#a855f7",
  learner:    "#64748b",
};
const DAY_MS = 24 * 60 * 60 * 1000;

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TeamStrip({ blueprintId }: { blueprintId: string }) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/clients/${blueprintId}/team`)
      .then((r) => (r.ok ? (r.json() as Promise<{ team: TeamMember[] }>) : Promise.resolve({ team: [] })))
      .then((d) => setTeam(d.team ?? []))
      .catch(() => setTeam([]));
  }, [blueprintId]);

  if (team.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
      {team.map((m) => {
        const accent = ACCENT[m.role] ?? "#64748b";
        const active = m.lastActiveAt != null && Date.now() - new Date(m.lastActiveAt).getTime() < DAY_MS;
        return (
          <div
            key={m.role}
            onMouseEnter={() => setHover(m.role)}
            onMouseLeave={() => setHover(null)}
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "14px",
              transform: hover === m.role ? "translateY(-2px)" : "none",
              transition: "transform 120ms ease, border-color 120ms ease",
              borderColor: hover === m.role ? "var(--border-strong, rgba(255,255,255,0.10))" : "var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <div style={{
                width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0,
                background: `${accent}22`, color: accent,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "14px", fontWeight: 700,
              }}>
                {m.agentName.charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.agentName}
                </div>
                <div style={{ fontSize: "10px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {m.roleLabel}
                </div>
              </div>
              <span style={{
                marginLeft: "auto", width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                background: active ? "#22c55e" : "var(--text-3)",
              }} />
            </div>

            <div style={{ fontSize: "11px", color: "var(--text-2)", lineHeight: 1.4, minHeight: "30px",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {m.lastAction ?? "Standing by"}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-3)", fontFamily: mono, marginTop: "6px" }}>
              {timeAgo(m.lastActiveAt)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
