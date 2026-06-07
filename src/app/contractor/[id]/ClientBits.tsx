"use client";

import { useState } from "react";

const gold = "var(--gold,#C9A84C)";

const btn: React.CSSProperties = {
  background: "transparent",
  color: "var(--text-2,#a1a1aa)",
  border: "1px solid var(--border,rgba(255,255,255,0.12))",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
  cursor: "pointer",
};

/** Active ↔ paused toggle, authed by the magic-link token. */
export function PauseButton({
  id,
  token,
  initialStatus,
}: {
  id: string;
  token: string;
  initialStatus: string;
}): React.ReactElement {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const active = status === "active";

  async function toggle(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/contractor-portal/${id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, paused: active }),
      });
      const data = (await res.json()) as { status?: string };
      if (res.ok && data.status) setStatus(data.status);
    } catch {
      /* leave status unchanged */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={toggle} disabled={busy} style={btn}>
      {busy ? "…" : active ? "Pause my territory" : "Resume my territory"}
    </button>
  );
}

/** Shown when there's no valid token — request a fresh magic link by email. */
export function RequestLinkForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/contractor-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      setSent(true); // don't reveal anything
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <p style={{ color: "var(--text-2,#a1a1aa)" }}>If that email is registered, a secure link is on its way. Check your inbox.</p>;
  }

  return (
    <div>
      <p style={{ color: "var(--text-2,#a1a1aa)", marginBottom: 12 }}>Enter your email and we&apos;ll send your dashboard link.</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.co.uk"
        style={{
          width: "100%",
          background: "var(--surface-2,#111)",
          border: "1px solid var(--border,rgba(255,255,255,0.12))",
          borderRadius: 8,
          padding: "10px 12px",
          color: "var(--text-1,#fff)",
          marginBottom: 12,
        }}
      />
      <button
        onClick={submit}
        disabled={busy}
        style={{ width: "100%", background: gold, color: "#000", border: "none", borderRadius: 8, padding: "11px 16px", fontWeight: 600, cursor: "pointer" }}
      >
        {busy ? "Sending…" : "Email me my link"}
      </button>
    </div>
  );
}
