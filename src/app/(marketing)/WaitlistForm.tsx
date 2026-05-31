"use client";

/**
 * WaitlistForm — marketing-site waitlist capture (Sprint 16).
 * POSTs to /api/waitlist. Premium dark glass; inline success/error states.
 */

import { useState } from "react";

type State = "idle" | "submitting" | "done" | "error";

const inputStyle = {
  width: "100%", padding: "12px 14px", fontSize: "14px",
  background: "var(--surface-2)", border: "1px solid var(--border)",
  borderRadius: "8px", color: "var(--text-1)", outline: "none",
} as const;

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
          borderRadius: "12px", padding: "28px", textAlign: "center",
        }}
      >
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>✓</div>
        <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-1)" }}>You&apos;re on the list.</div>
        <div style={{ fontSize: "13px", color: "var(--text-2)", marginTop: "6px" }}>
          We&apos;ll be in touch as we open access. Welcome to the future of agency fulfilment.
        </div>
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
      <input style={inputStyle} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input style={inputStyle} type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input style={inputStyle} placeholder="Agency name" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
      <input style={inputStyle} placeholder="How many clients do you have?" value={clientCount} onChange={(e) => setClientCount(e.target.value)} />
      {state === "error" && (
        <div style={{ fontSize: "12px", color: "#ef4444" }}>{error}</div>
      )}
      <button
        type="submit"
        disabled={state === "submitting"}
        style={{
          marginTop: "4px", padding: "12px 16px", fontSize: "14px", fontWeight: 600,
          background: "var(--gold)", color: "#000", border: "none", borderRadius: "8px",
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
