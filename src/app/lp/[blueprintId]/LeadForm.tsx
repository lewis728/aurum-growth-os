/**
 * src/app/lp/[blueprintId]/LeadForm.tsx
 * Public lead-capture form (client component). Posts to /api/lp/submit which
 * signs server-side and forwards to the leads webhook. On success shows the
 * "we're calling you now" confirmation.
 */
"use client";

import { useState, useRef } from "react";
import type { CSSProperties } from "react";

interface Props {
  blueprintId:  string;
  accent:       string;   // hex incl. leading #
  ctaText:      string;
  questions:    string[]; // qualification questions from the client brief
}

const field: CSSProperties = {
  width: "100%", padding: "13px 14px", fontSize: "15px", color: "#111827",
  background: "#fff", border: "1px solid #d1d5db", borderRadius: "10px",
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};
const label: CSSProperties = {
  fontSize: "13px", fontWeight: 500, color: "#374151", marginBottom: "6px", display: "block",
};

export function LeadForm({ blueprintId, accent, ctaText, questions }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [phone,     setPhone]     = useState("");
  const [email,     setEmail]     = useState("");
  const [answers,   setAnswers]   = useState<Record<string, string>>({});
  const [status,    setStatus]    = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error,     setError]     = useState<string | null>(null);
  const startedAt = useRef<number>(Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !email.trim()) {
      setError("Please fill in your name, phone and email.");
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
          firstName, lastName, phone, email,
          qualificationAnswers: answers,
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
      <div style={{ textAlign: "center", padding: "8px 4px" }}>
        <div style={{ fontSize: "44px", lineHeight: 1, marginBottom: "12px" }}>📞</div>
        <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
          We&apos;re calling you now.
        </h3>
        <p style={{ fontSize: "15px", color: "#4b5563", margin: 0, lineHeight: 1.5 }}>
          Pick up — it&apos;ll be us. Keep your phone close.
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <div>
          <label style={label}>First name</label>
          <input style={field} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" autoComplete="given-name" />
        </div>
        <div>
          <label style={label}>Last name</label>
          <input style={field} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" autoComplete="family-name" />
        </div>
      </div>
      <div>
        <label style={label}>Phone</label>
        <input style={field} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07700 900123" autoComplete="tel" />
      </div>
      <div>
        <label style={label}>Email</label>
        <input style={field} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@email.com" autoComplete="email" />
      </div>

      {questions.map((q, i) => (
        <div key={i}>
          <label style={label}>{q}</label>
          <input
            style={field}
            value={answers[q] ?? ""}
            onChange={e => setAnswers(a => ({ ...a, [q]: e.target.value }))}
            placeholder="Your answer (optional)"
          />
        </div>
      ))}

      {error && <div style={{ fontSize: "13px", color: "#dc2626" }}>{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        style={{
          marginTop: "4px", padding: "15px", fontSize: "16px", fontWeight: 700,
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
        <span style={{ fontSize: "13px", color: "#6b7280" }}>We&apos;ll call you within 60 seconds</span>
      </div>
    </form>
  );
}
