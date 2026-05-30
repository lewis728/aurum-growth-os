"use client";

import { useState, useEffect, useRef } from "react";
import { SignedIn, SignedOut, RedirectToSignIn, UserButton } from "@clerk/nextjs";
import AddClientWizard from "@/components/dashboard/AddClientWizard";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import LeadDesk from "@/components/dashboard/LeadDesk";
import { LiveCallFeed } from "@/components/dashboard/LiveCallFeed";
import { BookingTimeline } from "@/components/dashboard/BookingTimeline";
import { SpendChart } from "@/components/dashboard/SpendChart";
import { BillingCard } from "@/components/billing/BillingCard";
import ConnectMetaButton from "@/components/onboarding/ConnectMetaButton";
import { ClientOverview } from "@/components/dashboard/ClientOverview";
import ClientSubAccount from "@/components/dashboard/ClientSubAccount";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ClientSummary {
  id: string;
  businessName: string;
  vertical: string;
  status: "live" | "paused" | "pending" | "setup";
  spendToday: number;
  leadsThisWeek: number;
  cpl: number | null;
  lastLeadAt: string | null;
}

interface ActivityItem {
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

interface Booking {
  time?: string;
  name: string;
  day?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtCurrency(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// 6px dot — no chip badge
function StatusDot({ status }: { status: ClientSummary["status"] }) {
  const color: Record<ClientSummary["status"], string> = {
    live:    "#22c55e",
    paused:  "#f59e0b",
    pending: "#71717a",
    setup:   "#52525b",
  };
  return (
    <span
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: color[status] ?? color.setup,
        flexShrink: 0,
      }}
    />
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({ activePage, onNavigate }: { activePage: string; onNavigate: (p: string) => void }) {
  const navMain = [
    { id: "dashboard", label: "Dashboard", icon: "⊞" },
    { id: "clients",   label: "Clients",   icon: "◎" },
    { id: "campaigns", label: "Campaigns", icon: "▶" },
  ];
  const navIntel = [
    { id: "leads",     label: "Leads",    icon: "↓" },
    { id: "calls",     label: "AI Calls", icon: "☎" },
    { id: "bookings",  label: "Bookings", icon: "📅" },
    { id: "analytics", label: "Analytics",icon: "↗" },
  ];
  const navSys = [
    { id: "billing",      label: "Billing",      icon: "💳" },
    { id: "integrations", label: "Integrations", icon: "⊕" },
    { id: "settings",     label: "Settings",     icon: "⚙" },
  ];

  const SectionLabel = ({ children }: { children: string }) => (
    <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 12px", marginBottom: "2px" }}>
      {children}
    </div>
  );

  const NavItem = ({ id, label, icon }: { id: string; label: string; icon: string }) => {
    const active = activePage === id;
    return (
      <button
        onClick={() => onNavigate(id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          height: "36px",
          padding: "0 12px",
          fontSize: "12px",
          borderRadius: "6px",
          textAlign: "left",
          border: "none",
          cursor: "pointer",
          background: active ? "rgba(255,255,255,0.08)" : "transparent",
          color: active ? "#fff" : "#666",
          transition: "background 0.1s ease, color 0.1s ease",
        }}
        onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#999"; } }}
        onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#666"; } }}
      >
        <span style={{ fontSize: "13px", lineHeight: 1, width: "16px", textAlign: "center", flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "240px",
        background: "#0a0a0a",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}
    >
      {/* Wordmark — logo.png must be saved to /public/logo.png */}
      <div style={{ display: "flex", alignItems: "center", padding: "16px 16px 14px" }}>
        <img src="/logo.png" alt="Aurum Growth" style={{ height: "28px", width: "auto" }} />
      </div>

      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px", display: "flex", flexDirection: "column", gap: "20px" }}>
        <div>
          <SectionLabel>Overview</SectionLabel>
          {navMain.map(n => <NavItem key={n.id} {...n} />)}
        </div>
        <div>
          <SectionLabel>Intelligence</SectionLabel>
          {navIntel.map(n => <NavItem key={n.id} {...n} />)}
        </div>
        <div>
          <SectionLabel>System</SectionLabel>
          {navSys.map(n => <NavItem key={n.id} {...n} />)}
        </div>
      </div>

      {/* User */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <UserButton afterSignOutUrl="/" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "12px", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Agency Owner</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI strip ──────────────────────────────────────────────────────────────────
function KpiStrip({ data, isLoading }: { data: Record<string, unknown> | null | undefined; isLoading: boolean }) {
  const hero = (data?.heroMetrics ?? {}) as Record<string, number | null>;
  const kpis = [
    { label: "Spend today",      value: isLoading ? "…" : hero.spendToday != null ? fmtCurrency(hero.spendToday as number) : "£0",  sub: "Live campaigns" },
    { label: "Leads today",      value: isLoading ? "…" : String(hero.leadsToday ?? 0),                                              sub: "All clients" },
    { label: "CPL this week",    value: isLoading ? "…" : hero.cplThisWeek != null ? fmtCurrency(hero.cplThisWeek as number) : "—", sub: "7-day average" },
    { label: "Booked this week", value: isLoading ? "…" : String(hero.bookedThisWeek ?? 0),                                         sub: "Confirmed appts" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", background: "#000" }}>
      {kpis.map((k, i) => (
        <div
          key={k.label}
          style={{
            padding: "20px 24px",
            borderRight: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none",
          }}
        >
          <div style={{ fontSize: "10px", color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
            {k.label}
          </div>
          <div className="font-mono" style={{ fontSize: "22px", color: "#fff", fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1 }}>
            {k.value}
          </div>
          <div style={{ fontSize: "11px", color: "#444", marginTop: "6px" }}>
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Client card (individual — fetches its own agent name + recent-action status) ─
interface RepSummary    { repName: string; }
interface ActionSummary { executedAt: string; }

function ClientCard({ c, onSelectClient }: { c: ClientSummary; onSelectClient: (id: string) => void }) {
  const [agentName,       setAgentName]       = useState<string | null>(null);
  const [hasRecentAction, setHasRecentAction] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`/api/representative?blueprintId=${encodeURIComponent(c.id)}`)
        .then(r => r.ok ? r.json() as Promise<RepSummary | null> : Promise.resolve(null))
        .then(d => { if (d?.repName) setAgentName(d.repName); }),
      fetch(`/api/agent/actions?blueprintId=${encodeURIComponent(c.id)}`)
        .then(r => r.ok ? r.json() as Promise<{ actions: ActionSummary[] }> : Promise.resolve({ actions: [] }))
        .then(d => {
          const cutoff = Date.now() - 4 * 60 * 60 * 1000;
          setHasRecentAction((d.actions ?? []).some(a => new Date(a.executedAt).getTime() > cutoff));
        }),
    ]);
  }, [c.id]);

  return (
    <div
      onClick={() => onSelectClient(c.id)}
      style={{
        background: "#0c0c0c",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "8px",
        padding: "16px",
        cursor: "pointer",
        transition: "border-color 0.15s ease",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff", lineHeight: 1.3 }}>{c.businessName}</div>
          <div style={{ fontSize: "11px", color: "#555", marginTop: "3px" }}>{c.vertical}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {hasRecentAction && (
            <span
              className="animate-pulse"
              style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#C9A84C", display: "inline-block", flexShrink: 0 }}
            />
          )}
          <StatusDot status={c.status} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
        {[
          { label: "Spend/day", value: fmtCurrency(c.spendToday) },
          { label: "Leads/wk",  value: String(c.leadsThisWeek) },
          { label: "CPL",       value: c.cpl != null ? fmtCurrency(c.cpl) : "—" },
        ].map(m => (
          <div key={m.label}>
            <div style={{ fontSize: "11px", color: "#444", marginBottom: "2px" }}>{m.label}</div>
            <div className="font-mono" style={{ fontSize: "12px", color: "#ccc" }}>{m.value}</div>
          </div>
        ))}
      </div>
      <div style={{ paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "11px", color: "#444" }}>Last lead</span>
          <span className="font-mono" style={{ fontSize: "11px", color: "#555" }}>{timeAgo(c.lastLeadAt)}</span>
        </div>
        {agentName && (
          <div style={{ fontSize: "11px", color: "#555", marginTop: "6px" }}>
            Talk to {agentName} →
          </div>
        )}
      </div>
    </div>
  );
}

// ── Client cards ───────────────────────────────────────────────────────────────
function ClientCards({ onAddClient, onSelectClient, refreshSignal }: { onAddClient: () => void; onSelectClient: (id: string) => void; refreshSignal: number }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/clients/list")
      .then(r => r.ok ? r.json() as Promise<{ clients: ClientSummary[] }> : Promise.resolve({ clients: [] }))
      .then(d => { setClients(d.clients ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshSignal]);

  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {[0, 1].map(i => (
          <div key={i} style={{ height: "130px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", background: "#0a0a0a", animation: "pulse 2s infinite" }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
      {clients.map(c => (
        <ClientCard key={c.id} c={c} onSelectClient={onSelectClient} />
      ))}

      {/* Add client card */}
      <button
        onClick={onAddClient}
        style={{
          border: "1px dashed rgba(255,255,255,0.1)",
          background: "#000",
          borderRadius: "8px",
          minHeight: "130px",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          transition: "border-color 0.15s ease",
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)")}
        onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
      >
        <span style={{ fontSize: "20px", color: "#333", lineHeight: 1 }}>+</span>
        <span style={{ fontSize: "11px", color: "#444" }}>Add new client</span>
      </button>
    </div>
  );
}

// ── Activity feed ──────────────────────────────────────────────────────────────
function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);

  useEffect(() => {
    fetch("/api/activity/recent")
      .then(r => r.ok ? r.json() as Promise<{ items: ActivityItem[] }> : Promise.resolve({ items: [] }))
      .then(d => setItems(d.items ?? []))
      .catch(() => {});
  }, []);

  const iconMap: Record<string, string> = {
    lead: "↓", call: "☎", booking: "📅", campaign: "▶", default: "·",
  };

  return (
    <div style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>Recent activity</div>
        <div style={{ fontSize: "11px", color: "#444", cursor: "pointer" }}>View all →</div>
      </div>
      {items.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "80px", gap: "4px" }}>
          <div style={{ fontSize: "11px", color: "#333" }}>No activity yet</div>
        </div>
      ) : (
        <div>
          {items.slice(0, 5).map((item, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", padding: "10px 0", borderBottom: i < Math.min(items.length, 5) - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ width: "22px", height: "22px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#555", flexShrink: 0 }}>
                {iconMap[item.type] ?? iconMap.default}
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "#888", lineHeight: 1.4 }}>
                  <span style={{ color: "#ccc", fontWeight: 500 }}>{item.title}</span>
                  {item.description ? ` — ${item.description}` : ""}
                </div>
                <div style={{ fontSize: "10px", color: "#444", marginTop: "2px" }}>{timeAgo(item.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bookings panel ─────────────────────────────────────────────────────────────
function BookingsPanel({ bookings }: { bookings: Booking[] }) {
  return (
    <div style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>Upcoming bookings</div>
        <div style={{ fontSize: "11px", color: "#444", cursor: "pointer" }}>View all →</div>
      </div>
      {bookings.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80px" }}>
          <div style={{ fontSize: "11px", color: "#333" }}>No upcoming bookings</div>
        </div>
      ) : (
        <div>
          {bookings.slice(0, 5).map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: i < Math.min(bookings.length, 5) - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div className="font-mono" style={{ fontSize: "11px", color: "#555", width: "36px", flexShrink: 0 }}>{b.time ?? "—"}</div>
              <div style={{ flex: 1, fontSize: "12px", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
              <span style={{ fontSize: "10px", color: "#22c55e", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)", padding: "1px 6px", borderRadius: "4px" }}>{b.day ?? "Soon"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// AddClientModal replaced by AddClientWizard (see AddClientWizard.tsx)

// ── Agency chief-of-staff agent (compact collapsible bar) ─────────────────────
function AgencyAgent({ pendingMessage }: { pendingMessage?: string | null }) {
  const WELCOME = "Morning. I'm watching all your campaigns. Add your first client to get started — I'll manage everything from there.";
  const [chatMessages,  setChatMessages]  = useState<{ role: "user" | "agent"; content: string }[]>([
    { role: "agent", content: WELCOME },
  ]);
  const [chatInput,     setChatInput]     = useState("");
  const [isExpanded,    setIsExpanded]    = useState(false);
  const [isStreaming,   setIsStreaming]   = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingMessage) {
      setChatMessages(prev => [...prev, { role: "agent", content: pendingMessage }]);
      setIsExpanded(true);
    }
  }, [pendingMessage]);

  // Preview: last agent message, truncated
  const lastAgentContent = [...chatMessages].reverse().find(m => m.role === "agent")?.content ?? WELCOME;
  const preview = lastAgentContent.length > 80 ? lastAgentContent.slice(0, 80) + "…" : lastAgentContent;

  const handleSend = async () => {
    const message = chatInput.trim();
    if (!message || isStreaming) return;
    setChatInput("");
    setIsStreaming(true);
    setIsExpanded(true);
    setChatMessages(prev => [...prev, { role: "user", content: message }]);

    try {
      const response = await fetch("/api/agent/agency-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message }),
      });

      if (!response.ok || !response.body) {
        setChatMessages(prev => [...prev, { role: "agent", content: "Something went wrong. Please try again." }]);
        return;
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let agentText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const parsed = JSON.parse(raw) as { text?: string };
            if (parsed.text) { agentText += parsed.text; setStreamingText(agentText); }
          } catch { /* ignore malformed SSE lines */ }
        }
      }

      setChatMessages(prev => [...prev, { role: "agent", content: agentText || "Done." }]);
      setStreamingText("");
    } catch {
      setChatMessages(prev => [...prev, { role: "agent", content: "Connection error. Please try again." }]);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", overflow: "hidden" }}>
      {/* Expanded message history */}
      {isExpanded && (
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "260px", overflowY: "auto", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {chatMessages.map((msg, i) => (
            <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "84%", padding: "7px 11px", borderRadius: msg.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px", background: msg.role === "user" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: "12px", color: msg.role === "user" ? "#ccc" : "#888", lineHeight: 1.5 }}>
                {msg.content}
              </div>
            </div>
          ))}
          {streamingText && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ maxWidth: "84%", padding: "7px 11px", borderRadius: "10px 10px 10px 2px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", fontSize: "12px", color: "#888", lineHeight: 1.5 }}>
                {streamingText}<span style={{ opacity: 0.4 }}>&#x258A;</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Single-row bar — always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "0 16px", height: "60px" }}>
        {/* Logo — /public/logo.png must be saved to the project */}
        <img src="/logo.png" alt="Aurum" style={{ height: "20px", width: "auto", flexShrink: 0 }} />

        {/* "Aurum" label */}
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#C9A84C", flexShrink: 0 }}>Aurum</span>

        {/* Last message preview — click to toggle history */}
        <div
          onClick={() => setIsExpanded(e => !e)}
          style={{ flex: 1, fontSize: "12px", color: "#444", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {preview}
        </div>

        {/* Inline input */}
        <input
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onFocus={() => setIsExpanded(true)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder="Ask anything about your agency..."
          disabled={isStreaming}
          style={{ width: "220px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "6px", padding: "6px 10px", fontSize: "12px", color: "#ccc", outline: "none", fontFamily: "inherit", flexShrink: 0 }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={isStreaming || !chatInput.trim()}
          style={{ background: isStreaming || !chatInput.trim() ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", color: isStreaming || !chatInput.trim() ? "#333" : "#aaa", cursor: isStreaming || !chatInput.trim() ? "not-allowed" : "pointer", transition: "all 0.1s", flexShrink: 0 }}
        >
          {isStreaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ── Main dashboard view ────────────────────────────────────────────────────────
function DashboardView() {
  const [activePage,           setActivePage]           = useState("dashboard");
  const [showAddClient,        setShowAddClient]        = useState(false);
  const [selectedClientId,     setSelectedClientId]     = useState<string | null>(null);
  const [agentPendingMessage,  setAgentPendingMessage]  = useState<string | null>(null);
  const [clientsRefreshSignal, setClientsRefreshSignal] = useState(0);
  const { data, isLoading } = useDashboardMetrics();

  const handleClientAdded = (agentName: string, businessName: string) => {
    setClientsRefreshSignal(s => s + 1);
    setAgentPendingMessage(
      `${agentName} is now live on ${businessName}'s landing page. ${agentName} will call every new lead within 60 seconds and book them straight into the calendar. I'll send you a morning briefing every day at 6am.`
    );
  };

  const bookings: Booking[] = (data?.upcomingBookings ?? []).map((b) => ({
    name: b.leadName,
    time: new Date(b.slotTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    day:  new Date(b.slotTime).toLocaleDateString("en-GB", { weekday: "short" }),
  }));

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#000" }}>
      {/* Sidebar */}
      <Sidebar activePage={activePage} onNavigate={(p) => { setActivePage(p); setSelectedClientId(null); }} />

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", height: "48px", background: "#000", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff", textTransform: "capitalize" }}>
            {selectedClientId ? "Client" : activePage}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 10px", height: "32px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", borderRadius: "6px", fontSize: "12px", color: "#666", cursor: "pointer" }}
            >
              Search
              <span className="font-mono" style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.08)", color: "#555", background: "rgba(255,255,255,0.03)" }}>⌘K</span>
            </button>
            <button
              onClick={() => setShowAddClient(true)}
              style={{ background: "#fff", color: "#000", fontSize: "13px", fontWeight: 500, padding: "0 12px", height: "32px", borderRadius: "8px", border: "none", cursor: "pointer" }}
            >
              + Add client
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", background: "#000", padding: "24px" }}>
          {selectedClientId ? (
            <ClientSubAccount clientId={selectedClientId} onBack={() => setSelectedClientId(null)} />
          ) : (() => {
            switch (activePage) {
              case "dashboard":
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                    <KpiStrip data={data as unknown as Record<string, unknown>} isLoading={isLoading} />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>Clients</div>
                        <button onClick={() => setShowAddClient(true)} style={{ fontSize: "11px", color: "#555", background: "none", border: "none", cursor: "pointer" }}>
                          + Add client
                        </button>
                      </div>
                      <ClientCards onAddClient={() => setShowAddClient(true)} onSelectClient={setSelectedClientId} refreshSignal={clientsRefreshSignal} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <ActivityFeed />
                      <BookingsPanel bookings={bookings} />
                    </div>
                    <AgencyAgent pendingMessage={agentPendingMessage} />
                  </div>
                );
              case "leads":
                return <LeadDesk />;
              case "calls":
                return <LiveCallFeed calls={data?.recentCalls ?? []} isLoading={isLoading} />;
              case "bookings":
                return <BookingTimeline bookings={data?.upcomingBookings ?? []} isLoading={isLoading} />;
              case "analytics":
                return <SpendChart days={data?.spendChart ?? []} isLoading={isLoading} />;
              case "billing":
                return <BillingCard />;
              case "integrations":
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>Integrations</div>
                    <ConnectMetaButton />
                  </div>
                );
              case "clients":
                return <ClientOverview />;
              default:
                return (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                    <span style={{ fontSize: "13px", color: "#444" }}>Coming soon</span>
                  </div>
                );
            }
          })()}
        </div>
      </div>

      {showAddClient && (
        <AddClientWizard
          onClose={() => setShowAddClient(false)}
          onSuccess={handleClientAdded}
        />
      )}
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────────
export default function DashboardPageClient(): JSX.Element {
  return (
    <>
      <SignedIn>
        <DashboardView />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
