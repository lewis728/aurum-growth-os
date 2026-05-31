"use client";

/**
 * OutreachConsole — the cold-email outbound cockpit (dashboard "Outreach" tab).
 * Apollo/Clay → 2-stage qualify → adversarial hook → 5-email sequence → Instantly.
 *
 * - Pipeline strip: Prospects | Emailing | Replied | Demo Booked | Closed
 * - Add prospect modal → POST /api/outreach/generate → shows the 5 emails (copy)
 * - Import from Apollo CSV (paste) → POST /api/outreach/import
 * - Batch generate pending → POST /api/outreach/batch-generate
 * - Prospect table: status badge, fit score, last contacted, notes, status dropdown
 * - Expand a prospect → its email sequence with per-email Copy buttons
 * - Push generated → Instantly (1-click approve) → POST /api/outreach/push
 *
 * Matches the dashboard's premium dark style. Gold accents. Client component.
 */

import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Prospect {
  id: string; firstName: string | null; lastName: string | null;
  companyName: string; cleanCompanyName: string | null; website: string;
  vertical: string; location: string | null; contactEmail: string | null;
  status: string; source: string; customHook: string | null;
  fitScore: number | null; qualified: boolean | null; qualifyReason: string | null;
  emailsSent: number; lastEmailAt: string | null; repliedAt: string | null;
  bookedAt: string | null; notes: string | null; instantlyLeadId: string | null;
  createdAt: string;
}
interface Counts { pending: number; generated: number; emailing: number; replied: number; booked: number; closed: number; }
interface SeqEmail { emailNumber: number; subject: string; body: string; scheduledAt: string | null; }
interface GenEmail { day: number; emailNumber: number; subject: string; body: string; }

// ── Styles ───────────────────────────────────────────────────────────────────
const GOLD = "#C9A84C";
const card = { background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px" } as const;
const inputStyle = {
  width: "100%", padding: "10px 12px", fontSize: "13px", background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", color: "#eee", outline: "none",
} as const;
const goldBtn = {
  background: GOLD, color: "#000", fontSize: "13px", fontWeight: 600,
  border: "none", borderRadius: "6px", cursor: "pointer", padding: "10px 16px",
} as const;
const ghostBtn = {
  background: "rgba(255,255,255,0.04)", color: "#ccc", fontSize: "13px", fontWeight: 500,
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", cursor: "pointer", padding: "10px 16px",
} as const;

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:    { label: "Pending",    color: "#71717a" },
  qualifying: { label: "Qualifying", color: "#a1a1aa" },
  rejected:   { label: "Rejected",   color: "#ef4444" },
  errored:    { label: "Errored",    color: "#f59e0b" },
  generated:  { label: "Generated",  color: GOLD },
  emailing:   { label: "Emailing",   color: "#3b82f6" },
  replied:    { label: "Replied",    color: "#22c55e" },
  booked:     { label: "Booked",     color: "#22c55e" },
  closed:     { label: "Closed",     color: "#52525b" },
};
const STATUS_OPTIONS = ["pending", "qualifying", "generated", "emailing", "replied", "booked", "rejected", "errored", "closed"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}
      style={{ fontSize: "11px", fontWeight: 600, color: done ? "#22c55e" : GOLD, background: "none", border: "none", cursor: "pointer", padding: 0 }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", color: m.color }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: m.color, display: "inline-block" }} />
      {m.label}
    </span>
  );
}

// ── Add-prospect modal ───────────────────────────────────────────────────────
function AddProspectModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [emails, setEmails] = useState<GenEmail[] | null>(null);
  const [hook, setHook] = useState("");
  const [rejected, setRejected] = useState<{ score: number; reason: string } | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (running) return;
    setRunning(true); setError(""); setEmails(null); setRejected(null);
    try {
      const res = await fetch("/api/outreach/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, businessName, website, location, vertical: "aesthetics" }),
      });
      const data = await res.json() as { ok?: boolean; rejected?: boolean; fitScore?: number; reason?: string; customHook?: string; emails?: GenEmail[]; error?: string };
      if (data.ok && data.emails) { setEmails(data.emails); setHook(data.customHook ?? ""); onGenerated(); }
      else if (data.rejected) { setRejected({ score: data.fitScore ?? 0, reason: data.reason ?? "Did not meet ICP criteria." }); }
      else { setError(data.error ?? "Generation failed. Please try again."); }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  const allText = emails ? emails.map((e) => `Day ${e.day} — Subject: ${e.subject}\n\n${e.body}`).join("\n\n———\n\n") : "";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "100%", maxWidth: "640px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>Add prospect</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: "18px", cursor: "pointer" }}>×</button>
        </div>

        {!emails ? (
          <form onSubmit={run} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <input style={inputStyle} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <input style={inputStyle} placeholder="Business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
            <input style={inputStyle} placeholder="Website (e.g. clinic.co.uk)" value={website} onChange={(e) => setWebsite(e.target.value)} required />
            <input style={inputStyle} placeholder="Location (e.g. Manchester)" value={location} onChange={(e) => setLocation(e.target.value)} />
            <button type="submit" disabled={running} style={{ ...goldBtn, gridColumn: "1 / -1", opacity: running ? 0.6 : 1 }}>
              {running ? "Qualifying + writing… (~20s)" : "Qualify & generate sequence"}
            </button>
            {rejected && (
              <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "#f59e0b", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "6px", padding: "10px" }}>
                Not a fit (score {rejected.score}/100). {rejected.reason}
              </div>
            )}
            {error && <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "#ef4444" }}>{error}</div>}
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "12px", color: "#888" }}>Hook: <span style={{ color: "#ddd" }}>{hook}</span></div>
              <CopyButton text={allText} label="Copy all 5" />
            </div>
            {emails.map((e) => (
              <div key={e.emailNumber} style={{ ...card, padding: "12px", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "11px", color: GOLD, fontWeight: 600 }}>Day {e.day} · Email {e.emailNumber}</span>
                  <CopyButton text={`Subject: ${e.subject}\n\n${e.body}`} />
                </div>
                <div style={{ fontSize: "12px", color: "#fff", fontWeight: 500, marginBottom: "6px" }}>{e.subject}</div>
                <div style={{ fontSize: "12px", color: "#aaa", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{e.body}</div>
              </div>
            ))}
            <button onClick={onClose} style={ghostBtn}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CSV import modal ─────────────────────────────────────────────────────────
function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number; skipped: number; parsed: number } | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (running || !csv.trim()) return;
    setRunning(true); setError("");
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, vertical: "aesthetics" }),
      });
      const data = await res.json() as { imported?: number; duplicates?: number; skipped?: number; parsed?: number; error?: string };
      if (!res.ok) { setError(data.error ?? "Import failed."); return; }
      setResult({ imported: data.imported ?? 0, duplicates: data.duplicates ?? 0, skipped: data.skipped ?? 0, parsed: data.parsed ?? 0 });
      onImported();
    } catch {
      setError("Network error.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "100%", maxWidth: "640px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>Import from Apollo CSV</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: "18px", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
          Paste your Apollo CSV export. Expected columns: First Name, Last Name, Company, Website, City, Email. Deduplicated by domain.
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="First Name,Last Name,Company,Website,City,Email&#10;Jane,Doe,Glow Aesthetics,glowaesthetics.co.uk,Leeds,jane@glow.co.uk"
          style={{ ...inputStyle, minHeight: "160px", fontFamily: "var(--font-mono, monospace)", fontSize: "12px", resize: "vertical" }}
        />
        {result ? (
          <div style={{ fontSize: "13px", color: "#22c55e", marginTop: "12px" }}>
            Imported {result.imported} · {result.duplicates} duplicates skipped · {result.skipped} unusable ({result.parsed} parsed).
            <div style={{ fontSize: "12px", color: "#888", marginTop: "6px" }}>Now hit “Generate pending” to qualify + write sequences in bulk.</div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <button onClick={() => void run()} disabled={running || !csv.trim()} style={{ ...goldBtn, opacity: running || !csv.trim() ? 0.5 : 1 }}>
              {running ? "Importing…" : "Import"}
            </button>
            <button onClick={onClose} style={ghostBtn}>Cancel</button>
          </div>
        )}
        {error && <div style={{ fontSize: "12px", color: "#ef4444", marginTop: "10px" }}>{error}</div>}
      </div>
    </div>
  );
}

// ── Expanded sequence row ────────────────────────────────────────────────────
function SequencePanel({ prospectId }: { prospectId: string }) {
  const [emails, setEmails] = useState<SeqEmail[] | null>(null);
  useEffect(() => {
    void fetch(`/api/outreach/prospects/${prospectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { prospect?: { sequences?: SeqEmail[] } } | null) => setEmails(d?.prospect?.sequences ?? []))
      .catch(() => setEmails([]));
  }, [prospectId]);

  if (emails === null) return <div style={{ fontSize: "12px", color: "#555", padding: "12px" }}>Loading sequence…</div>;
  if (emails.length === 0) return <div style={{ fontSize: "12px", color: "#555", padding: "12px" }}>No sequence generated yet.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px", background: "#080808" }}>
      {emails.map((e) => (
        <div key={e.emailNumber} style={{ ...card, padding: "10px 12px", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px", color: GOLD, fontWeight: 600 }}>
              Email {e.emailNumber} · {fmtDate(e.scheduledAt)}
            </span>
            <CopyButton text={`Subject: ${e.subject}\n\n${e.body}`} />
          </div>
          <div style={{ fontSize: "12px", color: "#fff", fontWeight: 500 }}>{e.subject}</div>
          <div style={{ fontSize: "12px", color: "#999", lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: "4px" }}>{e.body}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function OutreachConsole() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, generated: 0, emailing: 0, replied: 0, booked: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [flash, setFlash] = useState("");
  const [flashWarn, setFlashWarn] = useState(false);

  const load = useCallback(() => {
    void fetch("/api/outreach/prospects")
      .then((r) => (r.ok ? r.json() : { prospects: [], counts }))
      .then((d: { prospects: Prospect[]; counts: Counts }) => { setProspects(d.prospects ?? []); if (d.counts) setCounts(d.counts); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  function flashMsg(msg: string, warn = false) { setFlash(msg); setFlashWarn(warn); }

  async function batchGenerate() {
    if (busy) return;
    setBusy("generate"); flashMsg("");
    try {
      const res = await fetch("/api/outreach/batch-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 25 }) });
      const d = await res.json() as { ok?: boolean; processed?: number; generated?: number; rejected?: number; errored?: number };
      const errored = d.errored ?? 0;
      flashMsg(`Processed ${d.processed ?? 0}: ${d.generated ?? 0} generated, ${d.rejected ?? 0} rejected, ${errored} errored.`, errored > 0 || (d.generated ?? 0) === 0);
      load();
    } catch { flashMsg("Batch generation failed.", true); }
    finally { setBusy(""); }
  }

  async function pushAll() {
    if (busy) return;
    setBusy("push"); flashMsg("");
    try {
      const res = await fetch("/api/outreach/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
      const d = await res.json() as { ok?: boolean; pushed?: number; failed?: number; notConfigured?: boolean; error?: string };
      if (d.notConfigured) flashMsg(d.error ?? "Instantly not configured.", true);
      else flashMsg(`Pushed ${d.pushed ?? 0} prospect(s) to Instantly${d.failed ? `, ${d.failed} failed` : ""}.`, !d.ok);
      load();
    } catch { flashMsg("Push failed.", true); }
    finally { setBusy(""); }
  }

  async function setStatus(id: string, status: string) {
    setProspects((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    await fetch(`/api/outreach/prospects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => {});
    load();
  }

  const pipeline = [
    { label: "Prospects", value: counts.pending + counts.generated },
    { label: "Emailing", value: counts.emailing },
    { label: "Replied", value: counts.replied },
    { label: "Demo Booked", value: counts.booked },
    { label: "Closed", value: counts.closed },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>Outreach</div>
          <div style={{ fontSize: "12px", color: "#666", marginTop: "4px", maxWidth: "560px" }}>
            Import prospects, auto-qualify against your ICP, and generate hyper-personalised 5-email
            sequences. Review, then push to Instantly in one click.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => setShowImport(true)} style={ghostBtn}>Import CSV</button>
          <button onClick={() => void batchGenerate()} disabled={busy === "generate"} title="Qualifies + writes sequences for up to 25 pending prospects (~£1–2 in AI per run)" style={{ ...ghostBtn, opacity: busy === "generate" ? 0.5 : 1 }}>
            {busy === "generate" ? "Generating…" : "Generate pending"}
          </button>
          <button onClick={() => void pushAll()} disabled={busy === "push"} style={{ ...ghostBtn, opacity: busy === "push" ? 0.5 : 1 }}>
            {busy === "push" ? "Pushing…" : "Push to Instantly"}
          </button>
          <button onClick={() => setShowAdd(true)} style={goldBtn}>+ Add prospect</button>
        </div>
      </div>

      {/* Pipeline strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
        {pipeline.map((p) => (
          <div key={p.label} style={{ ...card, padding: "16px" }}>
            <div className="font-mono" style={{ fontSize: "24px", color: "#fff", fontWeight: 300 }}>{p.value}</div>
            <div style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>{p.label}</div>
          </div>
        ))}
      </div>

      {flash && (
        <div style={{
          fontSize: "12px",
          color: flashWarn ? "#f59e0b" : "#aaa",
          background: flashWarn ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${flashWarn ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.07)"}`,
          borderRadius: "6px", padding: "10px 12px",
        }}>{flash}</div>
      )}

      {/* Prospect table */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 0.6fr 1fr 0.8fr 1.2fr", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <span>Business</span><span>Status</span><span>Fit</span><span>Last contact</span><span>Source</span><span>Move to</span>
        </div>
        {loading ? (
          <div style={{ padding: "24px", fontSize: "12px", color: "#555", textAlign: "center" }}>Loading prospects…</div>
        ) : prospects.length === 0 ? (
          <div style={{ padding: "32px", fontSize: "13px", color: "#555", textAlign: "center" }}>
            No prospects yet. Add one, or import an Apollo CSV.
          </div>
        ) : (
          prospects.map((p) => (
            <div key={p.id}>
              <div
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr 0.6fr 1fr 0.8fr 1.2fr", padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", alignItems: "center", cursor: "pointer" }}
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "13px", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cleanCompanyName || p.companyName}</div>
                  <div style={{ fontSize: "11px", color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.location || p.website}</div>
                </div>
                <StatusBadge status={p.status} />
                <span className="font-mono" style={{ fontSize: "12px", color: p.fitScore != null && p.fitScore >= 75 ? "#22c55e" : "#888" }}>{p.fitScore ?? "—"}</span>
                <span style={{ fontSize: "12px", color: "#888" }}>{fmtDate(p.lastEmailAt)}</span>
                <span style={{ fontSize: "11px", color: "#666" }}>{p.source}</span>
                <select
                  value={p.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => void setStatus(p.id, e.target.value)}
                  style={{ background: "rgba(255,255,255,0.04)", color: "#ccc", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", fontSize: "11px", padding: "5px 6px", cursor: "pointer" }}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>)}
                </select>
              </div>
              {expanded === p.id && (
                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  {p.customHook && (
                    <div style={{ padding: "10px 14px", fontSize: "12px", color: "#888" }}>
                      Hook: <span style={{ color: "#ddd" }}>{p.customHook}</span>
                      {p.qualifyReason && <span style={{ color: "#555" }}> · {p.qualifyReason}</span>}
                    </div>
                  )}
                  <SequencePanel prospectId={p.id} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showAdd && <AddProspectModal onClose={() => setShowAdd(false)} onGenerated={load} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={load} />}
    </div>
  );
}
