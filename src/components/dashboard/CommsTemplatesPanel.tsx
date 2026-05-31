"use client";

/**
 * CommsTemplatesPanel — editable SMS templates + call script (Sprint 3D).
 * The agency owner edits all communication templates in-app; changes save to
 * ClientBrief and go live for all future leads (the call script is pushed to the
 * Retell LLM immediately). No code change ever needed.
 *
 * SMS templates → PUT /api/clients/[id]/brief { smsTemplates }
 * Call script   → PUT /api/clients/[id]/script { script } (also pushes to Retell)
 *
 * Design: premium dark glass; per-field char count (SMS 160 warn); preview with
 * dummy data; save + reset-to-default.
 */

import { useState, useEffect, useCallback } from "react";

const SMS_KEYS = [
  { key: "bookedConfirmation", label: "Booking confirmation" },
  { key: "dayBefore",          label: "Day-before reminder" },
  { key: "hourBefore",         label: "Hour-before reminder" },
  { key: "qualifiedNudge",     label: "Qualified-but-not-booked nudge" },
  { key: "noShow",             label: "No-show follow-up" },
] as const;
type SmsKey = (typeof SMS_KEYS)[number]["key"];

const VARS = ["{{lead_first_name}}", "{{business_name}}", "{{appointment_time}}", "{{agent_name}}"];
const DUMMY: Record<string, string> = {
  lead_first_name: "Sarah", business_name: "Your Clinic",
  appointment_time: "Tuesday 2pm", agent_name: "Sophie",
};

function preview(t: string): string {
  return t.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => DUMMY[k] ?? m);
}

const cardStyle = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px" } as const;
const taStyle = {
  width: "100%", minHeight: "64px", resize: "vertical" as const, padding: "10px",
  background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px",
  color: "var(--text-1)", fontSize: "13px", lineHeight: 1.5, fontFamily: "inherit",
};

export function CommsTemplatesPanel({ blueprintId }: { blueprintId: string }) {
  const [sms, setSms] = useState<Record<SmsKey, string>>({
    bookedConfirmation: "", dayBefore: "", hourBefore: "", qualifiedNudge: "", noShow: "",
  });
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingSms, setSavingSms] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [previewKey, setPreviewKey] = useState<SmsKey | null>(null);

  const load = useCallback(() => {
    void Promise.all([
      fetch(`/api/clients/${blueprintId}/brief`).then((r) => (r.ok ? r.json() : { brief: null })),
      fetch(`/api/clients/${blueprintId}/script`).then((r) => (r.ok ? r.json() : { script: null })),
    ]).then(([b, s]: [{ brief: { smsTemplates?: Record<string, string> | null } | null }, { script: string | null }]) => {
      const t = b.brief?.smsTemplates ?? {};
      setSms({
        bookedConfirmation: t.bookedConfirmation ?? "",
        dayBefore:          t.dayBefore ?? "",
        hourBefore:         t.hourBefore ?? "",
        qualifiedNudge:     t.qualifiedNudge ?? "",
        noShow:             t.noShow ?? "",
      });
      setScript(s.script ?? "");
    }).catch(() => { /* leave blanks */ }).finally(() => setLoading(false));
  }, [blueprintId]);

  useEffect(() => { load(); }, [load]);

  async function saveSms() {
    setSavingSms(true); setMsg(null);
    try {
      // Send only non-empty fields; blanks fall back to vertical defaults server-side.
      const payload: Record<string, string> = {};
      for (const { key } of SMS_KEYS) if (sms[key].trim()) payload[key] = sms[key].trim();
      const res = await fetch(`/api/clients/${blueprintId}/brief`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smsTemplates: payload }),
      });
      setMsg(res.ok ? { kind: "ok", text: "SMS templates saved — live for future leads." } : { kind: "err", text: "Could not save SMS templates." });
    } finally { setSavingSms(false); }
  }

  async function saveScript() {
    setSavingScript(true); setMsg(null);
    try {
      const res = await fetch(`/api/clients/${blueprintId}/script`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const data = (await res.json()) as { note?: string; error?: string };
      setMsg(res.ok ? { kind: "ok", text: data.note ?? "Script saved." } : { kind: "err", text: data.error ?? "Could not save script." });
    } finally { setSavingScript(false); }
  }

  if (loading) {
    return <div style={cardStyle}><span style={{ fontSize: "12px", color: "var(--text-3)" }}>Loading templates…</span></div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div className="text-sm font-medium mb-1" style={{ color: "var(--text-1)" }}>Messages &amp; scripts</div>
        <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
          Edit what your AI team says. Changes are live for all future leads — no redeploy.
          Variables: {VARS.join("  ")}
        </div>
      </div>

      {/* SMS templates */}
      <div style={cardStyle}>
        <div className="text-xs font-medium mb-3" style={{ color: "var(--text-1)" }}>SMS templates</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {SMS_KEYS.map(({ key, label }) => {
            const len = sms[key].length;
            const over = len > 160;
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px]" style={{ color: "var(--text-2)" }}>{label}</label>
                  <span className="text-[10px] font-mono" style={{ color: over ? "#f59e0b" : "var(--text-3)" }}>
                    {len}/160{over ? " · multi-part" : ""}
                  </span>
                </div>
                <textarea
                  value={sms[key]}
                  onChange={(e) => setSms((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder="Leave blank to use the vertical default"
                  style={taStyle}
                />
                <div className="flex items-center gap-3 mt-1">
                  <button onClick={() => setPreviewKey(previewKey === key ? null : key)} className="text-[10px]" style={{ color: "var(--gold)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    {previewKey === key ? "Hide preview" : "Preview"}
                  </button>
                </div>
                {previewKey === key && sms[key].trim() && (
                  <div className="mt-1 text-[12px] rounded-md p-2" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                    {preview(sms[key])}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={() => void saveSms()} disabled={savingSms} className="mt-4 text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-40" style={{ background: "var(--gold)", color: "#000", border: "none", cursor: "pointer" }}>
          {savingSms ? "Saving…" : "Save SMS templates"}
        </button>
      </div>

      {/* Call script */}
      <div style={cardStyle}>
        <div className="text-xs font-medium mb-1" style={{ color: "var(--text-1)" }}>Sophie&apos;s call script</div>
        <div className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
          Edit how Sophie speaks on the phone. Saving pushes it live to the voice agent — effective on the next call.
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Sophie's call script…"
          style={{ ...taStyle, minHeight: "180px", fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}
        />
        <button onClick={() => void saveScript()} disabled={savingScript || !script.trim()} className="mt-3 text-xs font-medium px-4 py-2 rounded-lg disabled:opacity-40" style={{ background: "var(--gold)", color: "#000", border: "none", cursor: "pointer" }}>
          {savingScript ? "Saving…" : "Save & push live"}
        </button>
      </div>

      {msg && (
        <div className="text-xs" style={{ color: msg.kind === "ok" ? "#22c55e" : "#ef4444" }}>{msg.text}</div>
      )}
    </div>
  );
}
