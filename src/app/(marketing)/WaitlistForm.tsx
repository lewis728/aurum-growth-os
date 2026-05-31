"use client";

/**
 * WaitlistForm — marketing-site waitlist capture (Sprint 16, premium redesign).
 * POSTs to /api/waitlist. Dark card, gold accent on focus, animated checkmark on
 * success. CSS-only motion; no npm packages.
 */

import { useState } from "react";

type State = "idle" | "submitting" | "done" | "error";

// Controlled input with a gold focus ring (inline styles can't do :focus, so we
// toggle on focus/blur).
function Field(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      placeholder={props.placeholder}
      required={props.required}
      onChange={(e) => props.onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%", padding: "12px 14px", fontSize: "14px",
        background: "var(--surface-2)", color: "var(--text-1)",
        borderRadius: "8px", outline: "none",
        border: `1px solid ${focused ? "var(--gold)" : "var(--border)"}`,
        boxShadow: focused ? "0 0 0 3px rgba(201,168,76,0.15)" : "none",
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
      }}
    />
  );
}

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [clientCount, setClientCount] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "submitting") return;
    setState("submitting"); setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, agencyName, clientCount, source: "marketing_site" }),
      });
      if (res.ok) { setState("done"); return; }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong. Please try again.");
      setState("error");
    } catch {
      setError("Network error. Please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div
        style={{
          background: "var(--surface-1)", border: "1px solid var(--border-strong)",
          borderRadius: "12px", padding: "36px 28px", textAlign: "center",
        }}
      >
        <div className="wl-check" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path className="wl-check-path" d="M5 13l4 4L19 7" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ fontSize: "17px", fontWeight: 600, color: "var(--text-1)" }}>You&apos;re on the list.</div>
        <div style={{ fontSize: "13px", color: "var(--text-2)", marginTop: "6px" }}>
          We&apos;ll be in touch.
        </div>
        <style>{`
          .wl-check {
            width: 52px; height: 52px; margin: 0 auto 16px; border-radius: 999px;
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, #E8C766, var(--gold));
            box-shadow: 0 10px 30px -10px var(--gold);
            animation: wlPop 0.5s cubic-bezier(0.2,0.8,0.2,1.2) both;
          }
          .wl-check-path { stroke-dasharray: 30; stroke-dashoffset: 30; animation: wlDraw 0.45s ease 0.22s forwards; }
          @keyframes wlPop { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
          @keyframes wlDraw { to { stroke-dashoffset: 0; } }
          @media (prefers-reduced-motion: reduce) {
            .wl-check { animation: none; } .wl-check-path { animation: none; stroke-dashoffset: 0; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--surface-1)", border: "1px solid var(--border)",
        borderRadius: "12px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px",
      }}
    >
      <Field value={name} onChange={setName} placeholder="Your name" required />
      <Field value={email} onChange={setEmail} placeholder="Work email" type="email" required />
      <Field value={agencyName} onChange={setAgencyName} placeholder="Agency name" />
      <Field value={clientCount} onChange={setClientCount} placeholder="How many clients do you have?" />
      {state === "error" && (
        <div style={{ fontSize: "12px", color: "#ef4444" }}>{error}</div>
      )}
      <button
        type="submit"
        disabled={state === "submitting"}
        style={{
          marginTop: "4px", padding: "13px 16px", fontSize: "14px", fontWeight: 600,
          background: "linear-gradient(135deg, #E8C766, var(--gold))", color: "#000",
          border: "none", borderRadius: "8px",
          cursor: state === "submitting" ? "default" : "pointer", opacity: state === "submitting" ? 0.6 : 1,
        }}
      >
        {state === "submitting" ? "Joining…" : "Request early access"}
      </button>
      <div style={{ fontSize: "11px", color: "var(--text-3)", textAlign: "center" }}>
        No spam. We&apos;ll only email you about access.
      </div>
    </form>
  );
}
