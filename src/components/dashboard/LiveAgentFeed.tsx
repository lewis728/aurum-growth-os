/**
 * src/components/dashboard/LiveAgentFeed.tsx
 * Live Activity — realtime stream of agent actions for the tenant.
 * New rows fade in from the top. No polling (Supabase Realtime via useAgentFeed).
 */
"use client";

import { useAgentFeed, type AgentActionItem } from "@/hooks/useAgentFeed";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Outcome → status colour. Green = booked, amber = qualified, red = no answer/failed.
function dotColor(a: AgentActionItem): string {
  const s = `${a.actionType} ${a.outcome}`.toLowerCase();
  if (s.includes("book"))                              return "#22c55e";
  if (s.includes("qualif"))                            return "#f59e0b";
  if (s.includes("no answer") || s.includes("no_answer") ||
      s.includes("fail") || s.includes("voicemail"))  return "#ef4444";
  if (s.includes("call") || s.includes("placed") || s.includes("initiat")) return "#C9A84C";
  return "#71717a";
}

export function LiveAgentFeed() {
  const { actions, isLive, isLoading } = useAgentFeed();

  return (
    <>
      <style>{`
        @keyframes feedIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>Live Activity</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              className={isLive ? "animate-pulse" : undefined}
              style={{ width: "6px", height: "6px", borderRadius: "50%", background: isLive ? "#22c55e" : "#52525b", display: "inline-block" }}
            />
            <span style={{ fontSize: "11px", color: "#444" }}>{isLive ? "Live" : "Idle"}</span>
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80px", fontSize: "11px", color: "#333" }}>
            Loading activity…
          </div>
        ) : actions.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80px", fontSize: "11px", color: "#333" }}>
            No agent activity yet
          </div>
        ) : (
          <div style={{ maxHeight: "320px", overflowY: "auto" }}>
            {actions.map((a, i) => (
              <div
                key={a.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: "10px",
                  padding: "10px 0",
                  borderBottom: i < actions.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                  animation: "feedIn 0.3s ease",
                }}
              >
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: dotColor(a), flexShrink: 0, marginTop: "5px" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "#888", lineHeight: 1.4 }}>
                    <span style={{ color: "#ccc", fontWeight: 500 }}>{a.agentName}</span>
                    {" "}{a.outcome}
                  </div>
                  {a.reasoning && (
                    <div style={{ fontSize: "11px", color: "#555", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.reasoning}
                    </div>
                  )}
                </div>
                <span className="font-mono" style={{ fontSize: "10px", color: "#444", flexShrink: 0, marginTop: "2px" }}>
                  {timeAgo(a.executedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
