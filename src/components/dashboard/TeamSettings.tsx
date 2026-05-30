/**
 * src/components/dashboard/TeamSettings.tsx
 * Team management — lists organisation members with roles and invites by email.
 * Owner-only (the API enforces it). Dark theme to match the dashboard.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";

interface Member {
  id:    string;
  role:  string;
  name:  string | null;
  email: string | null;
}

const ROLES = ["owner", "manager", "viewer"];

const card: CSSProperties = {
  background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "20px",
};
const input: CSSProperties = {
  background: "#000", border: "1px solid #1a1a1a", borderRadius: "8px",
  padding: "8px 12px", fontSize: "13px", color: "#fff", outline: "none", fontFamily: "inherit",
};

export function TeamSettings() {
  const [members, setMembers] = useState<Member[]>([]);
  const [solo,    setSolo]    = useState(false);
  const [loading, setLoading] = useState(true);
  const [email,   setEmail]   = useState("");
  const [role,    setRole]    = useState("viewer");
  const [busy,    setBusy]    = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/team")
      .then(r => r.ok ? r.json() as Promise<{ members: Member[]; soloAccount: boolean }> : Promise.resolve({ members: [], soloAccount: false }))
      .then(d => { setMembers(d.members ?? []); setSolo(d.soloAccount ?? false); })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/team", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim(), role }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) { setMsg(`Invitation sent to ${email.trim()}.`); setEmail(""); load(); }
      else        { setMsg(data.error ?? "Invite failed."); }
    } catch {
      setMsg("Invite failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: "16px", maxWidth: "560px" }}>
      <div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}>Team</div>
        <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>
          Invite teammates and manage their access. Only owners can manage the team.
        </div>
      </div>

      {solo ? (
        <div style={{ fontSize: "12px", color: "#777" }}>
          You&apos;re on a solo account. Create an organisation to invite team members.
        </div>
      ) : (
        <>
          {/* Members */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {loading ? (
              <div style={{ fontSize: "12px", color: "#444" }}>Loading team…</div>
            ) : members.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#444" }}>No members yet.</div>
            ) : (
              members.map(m => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#ccc" }}>{m.name ?? m.email ?? "Member"}</div>
                    {m.email && m.name && <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>{m.email}</div>}
                  </div>
                  <span style={{ fontSize: "11px", color: "#C9A84C", textTransform: "capitalize", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: "6px", padding: "3px 8px" }}>
                    {m.role}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Invite */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teammate@email.com"
              style={{ ...input, flex: 1 }}
            />
            <select value={role} onChange={e => setRole(e.target.value)} style={{ ...input, cursor: "pointer", textTransform: "capitalize" }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              onClick={() => void invite()}
              disabled={busy || !email.trim()}
              style={{ background: busy || !email.trim() ? "#333" : "#C9A84C", color: "#000", fontWeight: 600, fontSize: "12px", padding: "8px 14px", borderRadius: "8px", border: "none", cursor: busy || !email.trim() ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              {busy ? "Inviting…" : "Invite"}
            </button>
          </div>

          {msg && <div style={{ fontSize: "11px", color: msg.includes("sent") ? "#22c55e" : "#ef4444" }}>{msg}</div>}
        </>
      )}
    </div>
  );
}
