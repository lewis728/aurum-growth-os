/**
 * src/components/dashboard/CreativePanel.tsx
 * Higgsfield creative generation for a client sub-account.
 * Generate (synchronous, ~up to 90s) → preview → Approve / Regenerate.
 */
"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

const STYLES = [
  { id: "before_after", label: "Before / After" },
  { id: "lifestyle",    label: "Lifestyle" },
  { id: "testimonial",  label: "Testimonial" },
  { id: "direct_offer", label: "Direct offer" },
];

interface CreativeAsset {
  assetId:      string;
  url:          string;
  thumbnailUrl: string;
}

const card: CSSProperties = {
  background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px",
};
const input: CSSProperties = {
  width: "100%", background: "#000", border: "1px solid #1a1a1a", borderRadius: "8px",
  padding: "10px 12px", fontSize: "13px", color: "#fff", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

export function CreativePanel({
  blueprintId, defaultBrief, agentName, recommended = false, recommendationReason,
}: {
  blueprintId: string;
  defaultBrief: string;
  agentName: string;
  recommended?: boolean;
  recommendationReason?: string;
}) {
  const [open,     setOpen]     = useState(false);
  const [brief,    setBrief]    = useState(defaultBrief);
  const [style,    setStyle]    = useState("direct_offer");
  const [asset,    setAsset]    = useState<CreativeAsset | null>(null);
  const [phase,    setPhase]    = useState<"idle" | "generating" | "done" | "error">("idle");
  const [approved, setApproved] = useState(false);

  const generate = async () => {
    setPhase("generating");
    setApproved(false);
    setAsset(null);
    try {
      const res = await fetch("/api/creative/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ blueprintId, brief, style }),
      });
      if (!res.ok) { setPhase("error"); return; }
      const data = (await res.json()) as { asset: CreativeAsset };
      setAsset(data.asset);
      setPhase("done");
    } catch {
      setPhase("error");
    }
  };

  const approve = async () => {
    if (!asset) return;
    const res = await fetch("/api/creative/approve", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ blueprintId, assetId: asset.assetId }),
    });
    if (res.ok) setApproved(true);
  };

  if (!open) {
    // When the agent has flagged creative fatigue, surface a recommendation
    // banner instead of the plain entry button.
    if (recommended) {
      return (
        <div style={{ ...card, borderColor: "rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.05)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#C9A84C", marginBottom: "4px" }}>
              {agentName} recommends
            </div>
            <div style={{ fontSize: "13px", color: "#ddd", lineHeight: 1.5 }}>
              {recommendationReason?.trim()
                ? recommendationReason
                : "This campaign's creative looks fatigued. Generating a fresh ad should lift performance."}
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            style={{ flexShrink: 0, background: "#C9A84C", color: "#000", fontWeight: 600, fontSize: "12px", padding: "8px 14px", borderRadius: "8px", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Generate now →
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...card, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "10px", color: "#ccc", fontSize: "13px", width: "100%" }}
      >
        <span style={{ color: "#C9A84C", fontSize: "16px" }}>✦</span>
        Generate creative with {agentName}
      </button>
    );
  }

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>Generate creative</div>
        <button onClick={() => setOpen(false)} style={{ color: "#444", background: "none", border: "none", fontSize: "18px", cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>

      <div>
        <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>Brief</div>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} style={{ ...input, resize: "vertical", minHeight: "64px" }} />
      </div>

      <div>
        <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>Style</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {STYLES.map(s => {
            const active = style === s.id;
            return (
              <button key={s.id} onClick={() => setStyle(s.id)} style={{
                padding: "9px 12px", textAlign: "left", cursor: "pointer", fontSize: "12px",
                background: active ? "rgba(201,168,76,0.08)" : "#000",
                border: `1px solid ${active ? "#C9A84C" : "#1a1a1a"}`,
                borderRadius: "8px", color: active ? "#C9A84C" : "#999",
              }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {phase === "generating" && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#C9A84C" }}>
          <span style={{ width: "12px", height: "12px", border: "2px solid rgba(201,168,76,0.3)", borderTopColor: "#C9A84C", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          {agentName} is creating your ad… this can take up to a minute.
        </div>
      )}

      {phase === "error" && (
        <div style={{ fontSize: "12px", color: "#ef4444" }}>Generation failed. Try again.</div>
      )}

      {phase === "done" && asset && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <video src={asset.url} poster={asset.thumbnailUrl} controls style={{ width: "100%", maxWidth: "260px", borderRadius: "8px", background: "#000", alignSelf: "center" }} />
          {approved ? (
            <div style={{ fontSize: "12px", color: "#22c55e", textAlign: "center" }}>✓ Approved — attached for the next campaign</div>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => void approve()} style={{ flex: 1, background: "#C9A84C", color: "#000", fontWeight: 600, fontSize: "13px", padding: "10px", borderRadius: "8px", border: "none", cursor: "pointer" }}>Approve</button>
              <button onClick={() => void generate()} style={{ flex: 1, background: "rgba(255,255,255,0.05)", color: "#ccc", fontSize: "13px", padding: "10px", borderRadius: "8px", border: "1px solid #1a1a1a", cursor: "pointer" }}>Regenerate</button>
            </div>
          )}
        </div>
      )}

      {phase === "idle" && (
        <button onClick={() => void generate()} style={{ background: "#C9A84C", color: "#000", fontWeight: 600, fontSize: "13px", padding: "11px", borderRadius: "8px", border: "none", cursor: "pointer" }}>
          Generate
        </button>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
