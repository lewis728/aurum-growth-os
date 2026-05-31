"use client";

/**
 * ProspectResearch — the "Win new clients" tool (Sprint 17).
 * Agency owner enters a prospect's URL + company name; we scrape, check Meta ads,
 * and GPT-4o writes a 90-day proposal. The result renders as a branded document
 * the owner can print/export to PDF (browser "Save as PDF" via print CSS — no
 * heavy PDF dependency added).
 *
 * POST /api/prospects/research → { research }; GET → { items } (history).
 */

import { useState, useEffect, useCallback } from "react";

interface Findings { adCount: number; sampleAds: string[]; usedAdLibrary: boolean; }
interface Research {
  id: string; companyName: string; websiteUrl: string; vertical: string | null;
  location: string | null; websiteSummary: string | null; competitorFindings: Findings | null;
  proposal: string | null; status: string; createdAt: string;
}

const card = { background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px" } as const;
const inputStyle = {
  width: "100%", padding: "10px 12px", fontSize: "13px", background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#eee", outline: "none",
} as const;

/** Minimal markdown → HTML for the proposal (headings, bold, lists, paragraphs). */
function renderProposal(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { closeList(); continue; }
    const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (t.startsWith("### ")) { closeList(); out.push(`<h3>${inline(t.slice(4))}</h3>`); }
    else if (t.startsWith("## ")) { closeList(); out.push(`<h2>${inline(t.slice(3))}</h2>`); }
    else if (t.startsWith("# ")) { closeList(); out.push(`<h2>${inline(t.slice(2))}</h2>`); }
    else if (/^[-*]\s+/.test(t)) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(t.replace(/^[-*]\s+/, ""))}</li>`); }
    else { closeList(); out.push(`<p>${inline(t)}</p>`); }
  }
  closeList();
  return out.join("");
}

export function ProspectResearch() {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<Research | null>(null);
  const [history, setHistory] = useState<Research[]>([]);

  const loadHistory = useCallback(() => {
    void fetch("/api/prospects/research")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: Research[] }) => setHistory(d.items ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    setRunning(true); setError(""); setCurrent(null);
    try {
      const res = await fetch("/api/prospects/research", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, websiteUrl, location }),
      });
      const data = (await res.json()) as { research?: Research; error?: string };
      if (!res.ok || !data.research) { setError(data.error ?? "Research failed. Please try again."); return; }
      setCurrent(data.research);
      loadHistory();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>Win new clients</div>
        <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
          Research any prospect — we scrape their site, check their Meta ads, and write a 90-day
          proposal you can walk into the pitch with.
        </div>
      </div>

      {/* Input form */}
      <form onSubmit={run} style={{ ...card, padding: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        <input style={inputStyle} placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
        <input style={inputStyle} placeholder="Website URL (e.g. acme.co.uk)" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} required />
        <input style={inputStyle} placeholder="Location (optional, e.g. Manchester)" value={location} onChange={(e) => setLocation(e.target.value)} />
        <button
          type="submit"
          disabled={running}
          style={{
            background: running ? "rgba(255,255,255,0.06)" : "var(--gold, #C9A84C)",
            color: running ? "#888" : "#000", fontSize: "13px", fontWeight: 600,
            border: "none", borderRadius: "6px", cursor: running ? "default" : "pointer", padding: "10px 16px",
          }}
        >
          {running ? "Researching… (~20s)" : "Research prospect"}
        </button>
        {error && <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "#ef4444" }}>{error}</div>}
      </form>

      {/* Result */}
      {current && (
        <div className="prospect-doc" style={{ ...card, padding: "28px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#fff" }}>{current.companyName}</div>
              <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>
                {current.websiteUrl}{current.vertical ? ` · ${current.vertical}` : ""}{current.location ? ` · ${current.location}` : ""}
              </div>
            </div>
            <button
              onClick={() => window.print()}
              className="no-print"
              style={{ fontSize: "12px", fontWeight: 600, color: "#000", background: "var(--gold, #C9A84C)", border: "none", borderRadius: "6px", padding: "8px 14px", cursor: "pointer" }}
            >
              Export PDF
            </button>
          </div>

          {current.status === "failed" ? (
            <div style={{ fontSize: "13px", color: "#ef4444" }}>{current.proposal}</div>
          ) : (
            <>
              {current.websiteSummary && (
                <div style={{ fontSize: "13px", color: "#aaa", lineHeight: 1.6, marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  {current.websiteSummary}
                </div>
              )}
              {current.competitorFindings && (
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "16px" }}>
                  {current.competitorFindings.usedAdLibrary
                    ? `${current.competitorFindings.adCount} live ads found in the Meta Ad Library.`
                    : "No live ads found in the Meta Ad Library — proposal written from market expertise."}
                </div>
              )}
              {current.proposal && (
                <div
                  className="proposal-body"
                  style={{ fontSize: "13px", color: "#ddd", lineHeight: 1.65 }}
                  dangerouslySetInnerHTML={{ __html: renderProposal(current.proposal) }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="no-print" style={{ ...card, padding: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff", marginBottom: "10px" }}>Past research</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {history.map((h, i) => (
              <button
                key={h.id || i}
                onClick={() => setCurrent(h)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "none", border: "none", textAlign: "left", cursor: "pointer",
                  padding: "10px 0", borderBottom: i < history.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                }}
              >
                <span style={{ fontSize: "12px", color: "#ccc" }}>
                  {h.companyName}
                  {h.status === "failed" && <span style={{ color: "#ef4444", marginLeft: "8px" }}>· failed</span>}
                </span>
                <span className="font-mono" style={{ fontSize: "11px", color: "#555" }}>
                  {new Date(h.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Print CSS — branded export via the browser's Save-as-PDF. */}
      <style>{`
        .proposal-body h2 { font-size: 15px; color: #fff; font-weight: 600; margin: 18px 0 8px; }
        .proposal-body h3 { font-size: 13px; color: #eee; font-weight: 600; margin: 14px 0 6px; }
        .proposal-body ul { margin: 6px 0 6px 18px; }
        .proposal-body li { margin: 3px 0; }
        .proposal-body p  { margin: 8px 0; }
        @media print {
          body * { visibility: hidden; }
          .prospect-doc, .prospect-doc * { visibility: visible; }
          .prospect-doc { position: absolute; inset: 0; background: #fff !important; color: #000 !important; border: none; padding: 32px; }
          .prospect-doc * { color: #000 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
