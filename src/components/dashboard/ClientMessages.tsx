"use client";

/**
 * ClientMessages — the message thread between the agency's client and the
 * Communicator agent, shown in the client sub-account (Sprint 9).
 *
 * The agency owner can: post a message AS the client (to test/simulate), see the
 * agent's drafted reply, and approve/dismiss replies the agent held for sign-off.
 * Auto-sent replies (questions/praise) appear already sent.
 */

import { useState, useEffect, useCallback } from "react";

interface ClientMessage {
  id:               string;
  direction:        "inbound" | "outbound";
  channel:          string;
  intent:           string | null;
  content:          string;
  agentResponse:    string | null;
  requiresApproval: boolean;
  sentAt:           string | null;
  createdAt:        string;
}

const INTENT_COLOR: Record<string, string> = {
  question:    "#3b82f6",
  praise:      "#22c55e",
  instruction: "#C9A84C",
  request:     "#f59e0b",
  complaint:   "#ef4444",
};

export function ClientMessages({ blueprintId }: { blueprintId: string }) {
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/clients/${blueprintId}/messages`)
      .then((r) => (r.ok ? (r.json() as Promise<{ messages: ClientMessage[] }>) : Promise.resolve({ messages: [] })))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => setMessages([]));
  }, [blueprintId]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${blueprintId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) { setInput(""); load(); }
    } finally { setBusy(false); }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${blueprintId}/messages/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) load();
    } finally { setBusy(false); }
  }

  async function dismiss(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${blueprintId}/messages/${id}/approve`, { method: "DELETE" });
      if (res.ok) load();
    } finally { setBusy(false); }
  }

  // Show newest first from the API; reverse to read top-to-bottom chronologically.
  const ordered = [...messages].reverse();

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Client messages</div>
        <div className="text-[11px]" style={{ color: "var(--text-3)" }}>{messages.length} total</div>
      </div>

      <div className="p-4 flex flex-col gap-3 max-h-[420px] overflow-y-auto">
        {ordered.length === 0 && (
          <span className="text-xs" style={{ color: "var(--text-3)" }}>No messages yet.</span>
        )}
        {ordered.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            {/* inbound message bubble */}
            {m.direction === "inbound" && (
              <div className="self-start max-w-[80%]">
                <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--surface-3)", color: "var(--text-1)" }}>
                  {m.content}
                </div>
                {m.intent && (
                  <span className="text-[10px] mt-1 inline-flex items-center gap-1" style={{ color: "var(--text-3)" }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: INTENT_COLOR[m.intent] ?? "var(--text-3)" }} />
                    {m.intent}
                  </span>
                )}
                {/* drafted reply held for approval */}
                {m.requiresApproval && m.agentResponse && (
                  <div className="mt-2 rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid rgba(201,168,76,0.4)" }}>
                    <div className="text-[10px] mb-1" style={{ color: "var(--gold)" }}>DRAFT REPLY — needs your approval</div>
                    <div className="text-sm" style={{ color: "var(--text-1)" }}>{m.agentResponse}</div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => approve(m.id)} disabled={busy} className="text-[11px] px-2 py-1 rounded-md font-medium disabled:opacity-40" style={{ background: "var(--gold)", color: "#000" }}>Approve & send</button>
                      <button onClick={() => dismiss(m.id)} disabled={busy} className="text-[11px] px-2 py-1 rounded-md disabled:opacity-40" style={{ color: "var(--text-3)" }}>Dismiss</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* outbound (sent) reply bubble */}
            {m.direction === "outbound" && (
              <div className="self-end max-w-[80%]">
                <div className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--gold)", color: "#000" }}>
                  {m.content}
                </div>
                <span className="text-[10px] mt-1 block text-right" style={{ color: "var(--text-3)" }}>sent</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder="Message as the client (to test the agent)…"
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-1)" }}
        />
        <button onClick={() => void send()} disabled={busy || !input.trim()} className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-40" style={{ background: "var(--gold)", color: "#000" }}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
