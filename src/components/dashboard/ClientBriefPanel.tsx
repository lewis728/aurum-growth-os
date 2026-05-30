/**
 * src/components/dashboard/ClientBriefPanel.tsx
 * The client knowledge brief editor — what the dedicated agent knows about this
 * client. Loads from GET /api/clients/[id]/brief, saves via PUT. Collapsible,
 * grouped by the agent's knowledge domains.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";

interface BriefData {
  idealCustomerProfile:   string;
  badLeadSignals:         string;
  qualificationQuestions: string;
  brandTone:              string;
  keyUSPs:                string;
  competitorNames:        string;
  complianceNotes:        string;
  businessHours:          string;
  websiteSummary:         string;
  reportingPreferences:   string;
  averageClientValue:     string;
  targetCplGbp:           string;
  budgetHardLimit:        string;
  approvalThreshold:      string;
}

const EMPTY: BriefData = {
  idealCustomerProfile: "", badLeadSignals: "", qualificationQuestions: "", brandTone: "",
  keyUSPs: "", competitorNames: "", complianceNotes: "", businessHours: "", websiteSummary: "",
  reportingPreferences: "", averageClientValue: "", targetCplGbp: "", budgetHardLimit: "", approvalThreshold: "",
};

const card: CSSProperties = {
  background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px",
};
const fieldStyle: CSSProperties = {
  width: "100%", background: "#000", border: "1px solid #1a1a1a", borderRadius: "8px",
  padding: "9px 11px", fontSize: "13px", color: "#fff", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const labelStyle: CSSProperties = {
  fontSize: "11px", color: "#888", marginBottom: "5px", display: "block",
};

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// ── Hoisted field components (defined outside the parent so they are not
// remounted on every keystroke — preserves input focus). ──────────────────────
function TextField({
  label, value, onChange, ph, rows = 2,
}: { label: string; value: string; onChange: (v: string) => void; ph?: string; rows?: number }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={ph} rows={rows} style={{ ...fieldStyle, resize: "vertical" }} />
    </div>
  );
}

function NumField({
  label, value, onChange, ph,
}: { label: string; value: string; onChange: (v: string) => void; ph?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={ph} style={fieldStyle} />
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#555", marginTop: "8px" }}>{children}</div>;
}

export function ClientBriefPanel({ blueprintId, agentName }: { blueprintId: string; agentName: string }) {
  const [open,    setOpen]    = useState(false);
  const [form,    setForm]    = useState<BriefData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/${blueprintId}/brief`)
      .then(r => r.ok ? r.json() as Promise<{ brief: Record<string, unknown> | null }> : Promise.resolve({ brief: null }))
      .then(d => {
        const b = d.brief;
        if (b) {
          setForm({
            idealCustomerProfile:   str(b.idealCustomerProfile),
            badLeadSignals:         str(b.badLeadSignals),
            qualificationQuestions: str(b.qualificationQuestions),
            brandTone:              str(b.brandTone),
            keyUSPs:                str(b.keyUSPs),
            competitorNames:        str(b.competitorNames),
            complianceNotes:        str(b.complianceNotes),
            businessHours:          str(b.businessHours),
            websiteSummary:         str(b.websiteSummary),
            reportingPreferences:   str(b.reportingPreferences),
            averageClientValue:     str(b.averageClientValue),
            targetCplGbp:           str(b.targetCplGbp),
            budgetHardLimit:        str(b.budgetHardLimit),
            approvalThreshold:      str(b.approvalThreshold),
          });
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false));
  }, [blueprintId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const set = (k: keyof BriefData) => (v: string) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${blueprintId}/brief`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(form),
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...card, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "10px", color: "#ccc", fontSize: "13px", width: "100%" }}
      >
        <span style={{ color: "#C9A84C", fontSize: "16px" }}>📋</span>
        Edit what {agentName} knows about this client
      </button>
    );
  }

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>Client brief</div>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>Everything {agentName} uses to manage this client</div>
        </div>
        <button onClick={() => setOpen(false)} style={{ color: "#444", background: "none", border: "none", fontSize: "18px", cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>

      {loading ? (
        <div style={{ fontSize: "12px", color: "#444" }}>Loading brief…</div>
      ) : (
        <>
          <SectionTitle>Customer</SectionTitle>
          <TextField label="Ideal customer" value={form.idealCustomerProfile} onChange={set("idealCustomerProfile")} ph="Who is the perfect lead? Demographics, location, situation." />
          <TextField label="Bad leads (the agent will avoid optimising toward these)" value={form.badLeadSignals} onChange={set("badLeadSignals")} ph="Tyre-kickers, out of area, wrong budget…" />

          <SectionTitle>Voice & guardrails</SectionTitle>
          <TextField label="Brand tone" value={form.brandTone} onChange={set("brandTone")} ph="e.g. warm and reassuring; premium and clinical" rows={1} />
          <TextField label="Key USPs" value={form.keyUSPs} onChange={set("keyUSPs")} ph="What makes them the obvious choice" />
          <TextField label="Compliance — never claim or say" value={form.complianceNotes} onChange={set("complianceNotes")} ph="Claims they legally can't make (critical for aesthetics/legal/finance)" />

          <SectionTitle>The sale</SectionTitle>
          <TextField label="Qualification questions" value={form.qualificationQuestions} onChange={set("qualificationQuestions")} ph="What Sophie should ask to qualify a lead" />
          <TextField label="Business hours (only call within these)" value={form.businessHours} onChange={set("businessHours")} ph="e.g. Mon–Fri 9am–7pm" rows={1} />

          <SectionTitle>The numbers</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <NumField label="Avg client value (£)" value={form.averageClientValue} onChange={set("averageClientValue")} ph="6000" />
            <NumField label="Target CPL (£)" value={form.targetCplGbp} onChange={set("targetCplGbp")} ph="40" />
            <NumField label="Budget hard limit (£/day)" value={form.budgetHardLimit} onChange={set("budgetHardLimit")} ph="200" />
            <NumField label="Approval threshold (£)" value={form.approvalThreshold} onChange={set("approvalThreshold")} ph="50" />
          </div>

          <SectionTitle>Market</SectionTitle>
          <TextField label="Competitors" value={form.competitorNames} onChange={set("competitorNames")} ph="Who else the customer might consider" rows={1} />
          <TextField label="Website summary (auto-filled from scrape — edit if needed)" value={form.websiteSummary} onChange={set("websiteSummary")} rows={2} />

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
            <button
              onClick={() => void save()}
              disabled={saving}
              style={{ background: saving ? "#333" : "#C9A84C", color: "#000", fontWeight: 600, fontSize: "13px", padding: "10px 18px", borderRadius: "8px", border: "none", cursor: saving ? "not-allowed" : "pointer" }}
            >
              {saving ? "Saving…" : "Save brief"}
            </button>
            {saved && <span style={{ fontSize: "12px", color: "#22c55e" }}>Saved — {agentName} will use this from the next cycle.</span>}
          </div>
        </>
      )}
    </div>
  );
}
