"use client";

import { useState, useEffect, useRef } from "react";
import { CreativePanel } from "@/components/dashboard/CreativePanel";
import { ClientBriefPanel } from "@/components/dashboard/ClientBriefPanel";
import { PipelineBoard, type PipelineLead } from "@/components/dashboard/PipelineBoard";
import { ClientMessages } from "@/components/dashboard/ClientMessages";
import { TeamStrip } from "@/components/dashboard/TeamStrip";

interface AgentAction {
  id:         string;
  agentName:  string;
  actionType: string;
  reasoning:  string;
  outcome:    string;
  executedAt: string;
}

interface ChatMessage {
  role:    "user" | "agent";
  content: string;
}

interface ClientData {
  id: string;
  businessName: string;
  vertical: string;
  status: string;
  dailyBudgetUsd: number;
  leadCount: number;
  appointmentCount: number;
  createdAt: string;
}

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: string;
  createdAt: string;
}

interface Representative {
  id: string;
  repName: string;
  personality: string;
}

interface Briefing {
  briefingText: string | null;
  briefingAt:   string | null;
  agentName:    string;
}

interface ObjectionCount {
  objection: string;
  count:     number;
}

interface ClientSubAccountProps {
  clientId: string;
  onBack: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function verticalLabel(v: string): string {
  return v
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const LEAD_STATUS: Record<string, { dot: string; label: string }> = {
  new:     { dot: "bg-blue-400",  label: "New" },
  called:  { dot: "bg-amber-400", label: "Called" },
  booked:  { dot: "bg-green-400", label: "Booked" },
  no_show: { dot: "bg-red-400",   label: "No show" },
  default: { dot: "bg-zinc-600",  label: "Unknown" },
};

const CLIENT_STATUS: Record<string, { dot: string; label: string }> = {
  live:       { dot: "bg-green-400",  label: "Live" },
  deploying:  { dot: "bg-blue-400",   label: "Deploying" },
  generating: { dot: "bg-purple-400", label: "Generating" },
  pending:    { dot: "bg-zinc-500",   label: "Pending" },
  paused:     { dot: "bg-amber-400",  label: "Paused" },
  failed:     { dot: "bg-red-400",    label: "Failed" },
  setup:      { dot: "bg-zinc-600",   label: "Setup" },
};

function StatusDot({ status }: { status: string }) {
  const s = CLIENT_STATUS[status.toLowerCase()] ?? { dot: "bg-zinc-600", label: status };
  return (
    <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-2)" }}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function actionToMessage(action: AgentAction): string {
  const map: Record<string, string> = {
    PAUSE_CAMPAIGN:             "I paused the campaign.",
    SCALE_BUDGET:               "I scaled the budget up.",
    RECOMMEND_CREATIVE_REFRESH: "I flagged this for creative review.",
    FLAG_LOW_CTR:               "I flagged a low CTR issue.",
    NO_ACTION:                  "I checked in — everything looks normal.",
    META_UNAVAILABLE:           "I couldn't reach Meta's API this cycle.",
    NO_META_CAMPAIGN:           "No Meta campaign is linked yet.",
  };
  const prefix = map[action.actionType] ?? "I took action.";
  return `${prefix} ${action.reasoning}`;
}

export default function ClientSubAccount({ clientId, onBack }: ClientSubAccountProps): JSX.Element {
  const [client, setClient] = useState<ClientData | null>(null);
  const [leads,  setLeads]  = useState<Lead[]>([]);
  const [rep,    setRep]    = useState<Representative | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [objections, setObjections] = useState<ObjectionCount[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [instructionConfirmed, setInstructionConfirmed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/agency/clients")
        .then((r) => r.ok ? r.json() as Promise<{ clients: ClientData[] }> : Promise.resolve({ clients: [] }))
        .then((d) => setClient(d.clients.find((c) => c.id === clientId) ?? null)),
      fetch(`/api/leads?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<Lead[]> : Promise.resolve([]))
        .then((d) => setLeads(Array.isArray(d) ? d : [])),
      fetch(`/api/representative?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<Representative | null> : Promise.resolve(null))
        .then((d) => setRep(d)),
      fetch(`/api/agent/actions?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<{ actions: AgentAction[] }> : Promise.resolve({ actions: [] }))
        .then((d) => setAgentActions(d.actions ?? [])),
      fetch(`/api/agent/briefing?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<Briefing> : Promise.resolve(null))
        .then((d) => setBriefing(d)),
      fetch(`/api/leads/objections?blueprintId=${encodeURIComponent(clientId)}`)
        .then((r) => r.ok ? r.json() as Promise<{ objections: ObjectionCount[] }> : Promise.resolve({ objections: [] }))
        .then((d) => setObjections(d.objections ?? [])),
    ]).finally(() => setLoading(false));
  }, [clientId]);

  const handleSend = async () => {
    const message = chatInput.trim();
    if (!message || isStreaming) return;
    setChatInput("");
    setIsStreaming(true);
    setInstructionConfirmed(false);
    setChatMessages(prev => [...prev, { role: "user", content: message }]);

    try {
      const response = await fetch("/api/agent/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ blueprintId: clientId, message }),
      });

      if (!response.ok || !response.body) {
        setChatMessages(prev => [...prev, { role: "agent", content: "Something went wrong. Please try again." }]);
        return;
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let agentText       = "";
      let instructionFlag = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const parsed = JSON.parse(raw) as { text?: string; instructionSaved?: boolean };
            if (parsed.instructionSaved) instructionFlag = true;
            if (parsed.text) {
              agentText += parsed.text;
              setStreamingText(agentText);
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }

      setChatMessages(prev => [...prev, { role: "agent", content: agentText || "Done." }]);
      setStreamingText("");
      if (instructionFlag) setInstructionConfirmed(true);
    } catch {
      setChatMessages(prev => [...prev, { role: "agent", content: "Connection error. Please try again." }]);
    } finally {
      setIsStreaming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--gold)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: "var(--text-3)" }}>
        Client not found.
      </div>
    );
  }

  const agentName = rep?.repName ?? "Not configured";
  const briefingAgentName = briefing?.agentName ?? agentName;
  const leadsThisWeek = leads.filter((l) => new Date(l.createdAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;
  const briefingTimestamp = briefing?.briefingAt
    ? new Date(briefing.briefingAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  // Sprint 13: surface the latest proactive campaign suggestion as a banner.
  const campaignSuggestion = agentActions.find((a) => a.actionType === "CAMPAIGN_SUGGESTION") ?? null;

  // Sprint 9: surface the agent's latest creative-fatigue flag on the creative panel.
  const creativeRecommendation = agentActions.find(
    (a) => a.actionType === "RECOMMEND_CREATIVE_REFRESH" || a.actionType === "FLAG_LOW_CTR"
  ) ?? null;

  const kpis = [
    { label: "Spend today",      value: "£0",                  sub: "Live campaigns" },
    { label: "Leads this week",  value: String(leadsThisWeek), sub: "7-day window" },
    { label: "Booked this week", value: "0",                   sub: "Confirmed appts" },
    { label: "CPL",              value: "—",                   sub: "Cost per lead" },
  ];

  return (
    <div className="space-y-5">
      {/* Back */}
      <button
        onClick={onBack}
        className="text-xs transition-colors"
        style={{ color: "var(--text-3)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-2)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-3)")}
      >
        ← All clients
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0"
            style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)" }}
          >
            {initials(client.businessName)}
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              {client.businessName}
            </h1>
            <div className="flex items-center gap-2.5 mt-1.5">
              <span
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)" }}
              >
                {verticalLabel(client.vertical)}
              </span>
              <StatusDot status={client.status} />
            </div>
          </div>
        </div>

        {/* Agent section */}
        <div
          className="flex items-center gap-3 px-3 py-2 rounded-lg"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: "var(--gold)" }}
          >
            {initials(agentName)}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "var(--text-3)" }}>
              AI Agent
            </div>
            <div className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
              {agentName}
            </div>
          </div>
        </div>
      </div>

      {/* Campaign suggestion banner (Sprint 13) */}
      {campaignSuggestion && (
        <div
          className="rounded-xl p-4 flex items-start justify-between gap-4"
          style={{ background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.25)" }}
        >
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#C9A84C" }}>
              Campaign suggestion
            </div>
            <div className="text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>
              {campaignSuggestion.reasoning}
            </div>
          </div>
          <button
            onClick={() => setChatInput(`Build the campaign you suggested for ${client.businessName}.`)}
            className="flex-shrink-0 text-xs font-semibold rounded-lg px-3 py-2"
            style={{ background: "#C9A84C", color: "#000", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Build campaign →
          </button>
        </div>
      )}

      {/* Morning briefing */}
      <div
        className="rounded-xl p-4"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderLeft: "2px solid var(--gold)" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
            style={{ background: "var(--gold)", color: "#000" }}
          >
            {initials(briefingAgentName)}
          </div>
          <div>
            <div className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{briefingAgentName}</div>
            <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-3)" }}>Morning briefing</div>
          </div>
        </div>

        {briefing?.briefingText ? (
          <>
            <div className="text-sm leading-relaxed" style={{ color: "var(--text-1)" }}>
              {briefing.briefingText}
            </div>
            {briefingTimestamp && (
              <div className="text-[10px] mt-3 font-mono" style={{ color: "var(--text-3)" }}>
                {briefingTimestamp}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm" style={{ color: "var(--text-3)" }}>
            {briefingAgentName} hasn&apos;t sent today&apos;s briefing yet. It arrives at 6am.
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div
        className="grid grid-cols-4 rounded-xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        {kpis.map((k, i) => (
          <div
            key={k.label}
            className="px-4 py-4"
            style={{ borderRight: i < 3 ? "1px solid var(--border)" : "none" }}
          >
            <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-3)" }}>
              {k.label}
            </div>
            <div className="text-xl font-medium font-mono tracking-tight" style={{ color: "var(--text-1)" }}>
              {k.value}
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* AI team strip (Sprint 3C) — the 5 specialist roles for this client. */}
      <div>
        <div className="text-sm font-medium mb-3" style={{ color: "var(--text-1)" }}>
          Their AI team
        </div>
        <TeamStrip blueprintId={clientId} />
      </div>

      {/* CRM pipeline (Sprint 3B) — leads move automatically by derived stage. */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Pipeline
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {leads.length} total
          </div>
        </div>
        <PipelineBoard leads={leads as unknown as PipelineLead[]} />
      </div>

      {/* Client messages (Sprint 9) — Communicator agent thread + approvals. */}
      <ClientMessages blueprintId={clientId} />

      {/* Legacy recent-leads table — retained, hidden (false &&) as a fallback ref. */}
      {false && (
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Recent leads
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {leads.length} total
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-xs" style={{ color: "var(--text-3)" }}>No leads yet</span>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Name", "Phone", "Status", "Time"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-medium"
                    style={{ color: "var(--text-3)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.slice(0, 20).map((l, i) => {
                const st = LEAD_STATUS[l.status] ?? LEAD_STATUS["default"]!;
                return (
                  <tr
                    key={l.id}
                    style={{ borderBottom: i < Math.min(leads.length, 20) - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <td className="px-4 py-3 font-medium" style={{ color: "var(--text-1)" }}>
                      {l.firstName} {l.lastName}
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ color: "var(--text-2)" }}>
                      {l.phone}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                        <span style={{ color: "var(--text-2)" }}>{st.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono" style={{ color: "var(--text-3)" }}>
                      {timeAgo(l.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* Objections (Sprint 12) */}
      {objections.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
        >
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Top objections</div>
            <div className="text-[11px]" style={{ color: "var(--text-3)" }}>Most common this week</div>
          </div>
          <div className="p-4 flex flex-col gap-2">
            {objections.map((o) => (
              <div key={o.objection} className="flex items-center justify-between">
                <span className="text-sm capitalize" style={{ color: "var(--text-2)" }}>{o.objection}</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                  {o.count}× heard
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Chat */}
      <div style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#000", flexShrink: 0 }}>
            {initials(agentName)}
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>{agentName}</div>
            <div style={{ fontSize: "11px", color: "#555" }}>Ask anything about this campaign</div>
          </div>
        </div>

        {/* Message history */}
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px", maxHeight: "340px", overflowY: "auto" }}>
          {/* Past agent actions shown as agent messages */}
          {agentActions.slice(0, 5).map((action) => (
            <div key={action.id} style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ maxWidth: "82%", padding: "8px 12px", borderRadius: "12px 12px 12px 2px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", fontSize: "12px", color: "#666", lineHeight: 1.5 }}>
                {actionToMessage(action)}
                <div style={{ fontSize: "10px", color: "#333", marginTop: "4px" }}>{timeAgo(action.executedAt)}</div>
              </div>
            </div>
          ))}

          {/* Chat history */}
          {chatMessages.map((msg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "82%", padding: "8px 12px", borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: msg.role === "user" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: "12px", color: msg.role === "user" ? "#ccc" : "#888", lineHeight: 1.5 }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Streaming token by token */}
          {streamingText && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ maxWidth: "82%", padding: "8px 12px", borderRadius: "12px 12px 12px 2px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", fontSize: "12px", color: "#888", lineHeight: 1.5 }}>
                {streamingText}
                <span style={{ opacity: 0.4 }}>&#x258A;</span>
              </div>
            </div>
          )}

          {/* Instruction confirmed banner */}
          {instructionConfirmed && (
            <div style={{ fontSize: "11px", color: "#C9A84C", background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: "6px", padding: "6px 10px", textAlign: "center" }}>
              Got it. I&apos;ll apply that from my next check-in.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: "8px" }}>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder={`Tell ${agentName} what you want...`}
            disabled={isStreaming}
            style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "6px", padding: "8px 12px", fontSize: "12px", color: "#ccc", outline: "none", fontFamily: "inherit" }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={isStreaming || !chatInput.trim()}
            style={{ background: isStreaming || !chatInput.trim() ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "8px 14px", fontSize: "12px", color: isStreaming || !chatInput.trim() ? "#333" : "#aaa", cursor: isStreaming || !chatInput.trim() ? "not-allowed" : "pointer", transition: "all 0.1s" }}
          >
            {isStreaming ? "…" : "Send"}
          </button>
        </div>
      </div>

      {/* Client knowledge brief */}
      <ClientBriefPanel blueprintId={client.id} agentName={agentName} />

      {/* Creative generation (Higgsfield) */}
      <CreativePanel
        blueprintId={client.id}
        agentName={agentName}
        defaultBrief={`${client.businessName} — ${verticalLabel(client.vertical)}`}
        recommended={creativeRecommendation !== null}
        recommendationReason={creativeRecommendation?.reasoning}
      />
    </div>
  );
}
