/**
 * src/app/lp/[blueprintId]/LeadForm.tsx
 * Public lead-capture form (client component). Low-friction B2C roofing form:
 * name + phone + roof issue required; postcode + email optional. Posts to
 * /api/lp/submit which signs server-side and forwards to the leads webhook.
 * On success shows the "we're calling you now" confirmation.
 */
"use client";

import { useState, useRef } from "react";
import type { CSSProperties } from "react";

interface Props {
  blueprintId: string;
  accent:      string; // hex incl. leading #
  ctaText:     string;
}

const ROOF_ISSUES = [
  "Leak / water coming in",
  "Missing or slipped tiles",
  "Storm / wind damage",
  "Flat roof problem",
  "Full re-roof / replacement",
  "Chimney or flashing",
  "Not sure — just need it looked at",
];

const field: CSSProperties = {
  width: "100%", padding: "14px 14px", fontSize: "16px", color: "#111827",
  background: "#fff", border: "1px solid #d1d5db", borderRadius: "10px",
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const label: CSSProperties = {
  fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px", display: "block",
};

export function LeadForm({ blueprintId, accent, ctaText }: Props) {
  const [name,      setName]      = useState("");
  const [phone,     setPhone]     = useState("");
  const [roofIssue, setRoofIssue] = useState("");
  const [postcode,  setPostcode]  = useState("");
  const [email,     setEmail]     = useState("");
  const [status,    setStatus]    = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error,     setError]     = useState<string | null>(null);
  const startedAt = useRef<number>(Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Please enter your name and phone number.");
      return;
    }
    if (!roofIssue) {
      setError("Please tell us what's up with your roof.");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/lp/submit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          blueprintId,
          name, phone, roofIssue,
          postcode: postcode.trim() || undefined,
          email:    email.trim() || undefined,
          fillDurationMs: Date.now() - startedAt.current,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div style={{ textAlign: "center", padding: "12px 4px" }}>
        <div style={{ fontSize: "44px", lineHeight: 1, marginBottom: "12px" }}>📞</div>
        <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
          We&apos;re calling you now.
        </h3>
        <p style={{ fontSize: "15px", color: "#4b5563", margin: 0, lineHeight: 1.5 }}>
          Pick up — it&apos;ll be us. Keep your phone close and we&apos;ll get your free survey booked in.
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
      <div>
        <label style={label}>Your name</label>
        <input style={field} value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" autoComplete="name" />
      </div>
      <div>
        <label style={label}>Phone</label>
        <input style={field} type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07700 900123" autoComplete="tel" />
      </div>
      <div>
        <label style={label}>What&apos;s up with your roof?</label>
        <select
          style={{ ...field, appearance: "none", color: roofIssue ? "#111827" : "#9ca3af" }}
          value={roofIssue}
          onChange={e => setRoofIssue(e.target.value)}
        >
          <option value="" disabled>Choose one…</option>
          {ROOF_ISSUES.map(o => <option key={o} value={o} style={{ color: "#111827" }}>{o}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={label}>Postcode <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
          <input style={field} value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="M1 2AB" autoComplete="postal-code" />
        </div>
        <div>
          <label style={label}>Email <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
          <input style={field} type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@email.com" autoComplete="email" />
        </div>
      </div>

      {error && <div style={{ fontSize: "13px", color: "#dc2626" }}>{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        style={{
          marginTop: "4px", padding: "16px", fontSize: "17px", fontWeight: 700,
          color: "#fff", background: submitting ? "#9ca3af" : accent,
          border: "none", borderRadius: "10px", cursor: submitting ? "not-allowed" : "pointer",
          transition: "opacity 0.15s",
        }}
      >
        {submitting ? "Sending…" : ctaText}
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", marginTop: "2px" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <span style={{ fontSize: "13px", color: "#6b7280" }}>We&apos;ll call you within 60 seconds · no obligation</span>
      </div>
    </form>
  );
}
