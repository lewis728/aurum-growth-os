"use client";

import { useState, useEffect } from "react";
import { SignedIn, SignedOut, RedirectToSignIn, UserButton } from "@clerk/nextjs";
import ChatWorkspace from "@/components/dashboard/ChatWorkspace";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";

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

function StatusBadge({ status }: { status: ClientSummary["status"] }) {
  const map = {
    live:    { label: "● Live",    cls: "bg-emerald-950 text-emerald-400 border-emerald-900" },
    paused:  { label: "⏸ Paused",  cls: "bg-amber-950 text-amber-400 border-amber-900" },
    pending: { label: "◌ Pending", cls: "bg-indigo-950 text-indigo-400 border-indigo-900" },
    setup:   { label: "◌ Setup",   cls: "bg-zinc-900 text-zinc-500 border-zinc-800" },
  };
  const { label, cls } = map[status] ?? map.setup;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {label}
    </span>
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
    { id: "leads",     label: "Leads",     icon: "↓" },
    { id: "calls",     label: "AI Calls",  icon: "☎" },
    { id: "bookings",  label: "Bookings",  icon: "📅" },
    { id: "analytics", label: "Analytics", icon: "↗" },
  ];
  const navSys = [
    { id: "billing",      label: "Billing",      icon: "💳" },
    { id: "integrations", label: "Integrations", icon: "⊕" },
    { id: "settings",     label: "Settings",     icon: "⚙" },
  ];

  const NavItem = ({ id, label, icon }: { id: string; label: string; icon: string }) => (
    <button
      onClick={() => onNavigate(id)}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all text-left ${
        activePage === id
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
      }`}
    >
      <span className="text-sm leading-none w-4 text-center">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-900">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-zinc-900">
        <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-black" style={{ backgroundColor: "#C9A84C" }}>
          A
        </div>
        <div>
          <div className="text-sm font-medium text-white leading-none">Aurum</div>
          <div className="text-[10px] text-zinc-600 leading-none mt-0.5">Growth OS</div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] uppercase tracking-widest text-zinc-700">Overview</div>
          <div className="space-y-0.5">
            {navMain.map(n => <NavItem key={n.id} {...n} />)}
          </div>
        </div>
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] uppercase tracking-widest text-zinc-700">Intelligence</div>
          <div className="space-y-0.5">
            {navIntel.map(n => <NavItem key={n.id} {...n} />)}
          </div>
        </div>
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] uppercase tracking-widest text-zinc-700">System</div>
          <div className="space-y-0.5">
            {navSys.map(n => <NavItem key={n.id} {...n} />)}
          </div>
        </div>
      </div>

      {/* User */}
      <div className="border-t border-zinc-900 px-3 py-3">
        <div className="flex items-center gap-2.5">
          <UserButton afterSignOutUrl="/" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-400 truncate">Agency Owner</div>
            <div className="text-[10px] text-zinc-700">Aurum Growth OS</div>
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
    <div className="grid grid-cols-4 border border-zinc-900 rounded-lg overflow-hidden" style={{ background: "#0d0d0d" }}>
      {kpis.map((k, i) => (
        <div key={k.label} className={`px-4 py-4 ${i < 3 ? "border-r border-zinc-900" : ""}`}>
          <div className="text-[10px] uppercase tracking-widest text-zinc-700 mb-2">{k.label}</div>
          <div className="text-xl font-medium text-white font-mono tracking-tight">{k.value}</div>
          <div className="text-[11px] text-zinc-700 mt-1">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Client cards ───────────────────────────────────────────────────────────────
function ClientCards({ onAddClient }: { onAddClient: () => void }) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/clients/list")
      .then(r => r.ok ? r.json() as Promise<{ clients: ClientSummary[] }> : Promise.resolve({ clients: [] }))
      .then(d => { setClients(d.clients ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {[0, 1].map(i => (
          <div key={i} className="h-32 rounded-lg border border-zinc-900 bg-zinc-950 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {clients.map(c => (
        <div
          key={c.id}
          className="rounded-lg border border-zinc-900 p-4 cursor-pointer transition-colors hover:border-zinc-700"
          style={{ background: "#0d0d0d" }}
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-medium text-white">{c.businessName}</div>
              <div className="text-[11px] text-zinc-600 mt-0.5">{c.vertical}</div>
            </div>
            <StatusBadge status={c.status} />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <div className="text-[10px] text-zinc-700 mb-0.5">Spend/day</div>
              <div className="text-sm font-medium text-zinc-300 font-mono">{fmtCurrency(c.spendToday)}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-700 mb-0.5">Leads/wk</div>
              <div className="text-sm font-medium text-zinc-300 font-mono">{c.leadsThisWeek}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-700 mb-0.5">CPL</div>
              <div className="text-sm font-medium text-zinc-300 font-mono">{c.cpl != null ? fmtCurrency(c.cpl) : "—"}</div>
            </div>
          </div>
          <div className="flex justify-between items-center pt-2.5 border-t border-zinc-900">
            <span className="text-[10px] text-zinc-700">Last lead</span>
            <span className="text-[10px] text-zinc-600 font-mono">{timeAgo(c.lastLeadAt)}</span>
          </div>
        </div>
      ))}

      {/* Add client card */}
      <button
        onClick={onAddClient}
        className="rounded-lg border border-dashed border-zinc-800 flex flex-col items-center justify-center gap-2 min-h-[130px] cursor-pointer transition-colors hover:border-yellow-900 group"
        style={{ background: "#050505" }}
      >
        <span className="text-2xl text-zinc-800 group-hover:text-zinc-600 transition-colors">+</span>
        <span className="text-[11px] text-zinc-700 group-hover:text-zinc-500 transition-colors">Add new client</span>
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
    lead: "↓", call: "☎", booking: "📅", campaign: "▶", default: "·"
  };

  return (
    <div className="rounded-lg border border-zinc-900 p-4" style={{ background: "#0d0d0d" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-white">Recent activity</div>
        <div className="text-[11px] text-zinc-700 cursor-pointer hover:text-zinc-400">View all →</div>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-20 gap-1">
          <div className="text-lg text-zinc-800">·</div>
          <div className="text-[11px] text-zinc-800">No activity yet</div>
        </div>
      ) : (
        <div className="space-y-0">
          {items.slice(0, 5).map((item, i) => (
            <div key={i} className="flex gap-2.5 py-2.5 border-b border-zinc-900 last:border-0">
              <div className="w-6 h-6 rounded-md border border-zinc-800 flex items-center justify-center text-xs text-zinc-600 flex-shrink-0" style={{ background: "#111" }}>
                {iconMap[item.type] ?? iconMap.default}
              </div>
              <div>
                <div className="text-xs text-zinc-500 leading-snug">
                  <span className="text-zinc-300 font-medium">{item.title}</span>
                  {item.description ? ` — ${item.description}` : ""}
                </div>
                <div className="text-[10px] text-zinc-700 mt-0.5">{timeAgo(item.createdAt)}</div>
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
    <div className="rounded-lg border border-zinc-900 p-4" style={{ background: "#0d0d0d" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-white">Upcoming bookings</div>
        <div className="text-[11px] text-zinc-700 cursor-pointer hover:text-zinc-400">View all →</div>
      </div>
      {bookings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-20 gap-1">
          <div className="text-[11px] text-zinc-800">No upcoming bookings</div>
        </div>
      ) : (
        <div className="space-y-0">
          {bookings.slice(0, 5).map((b, i) => (
            <div key={i} className="flex items-center gap-2.5 py-2.5 border-b border-zinc-900 last:border-0">
              <div className="text-[11px] text-zinc-600 font-mono w-10 flex-shrink-0">{b.time ?? "—"}</div>
              <div className="flex-1 text-xs text-zinc-400 truncate">{b.name}</div>
              <span className="text-[10px] text-emerald-500 bg-emerald-950 border border-emerald-900 px-1.5 py-0.5 rounded">{b.day ?? "Soon"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add Client Modal ───────────────────────────────────────────────────────────
function AddClientModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.8)" }}>
      <div className="rounded-xl border border-zinc-800 p-6 w-full max-w-lg mx-4" style={{ background: "#0d0d0d" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium text-white">Add new client</div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>
        <ChatWorkspace />
      </div>
    </div>
  );
}

// ── Main dashboard view ────────────────────────────────────────────────────────
function DashboardView() {
  const [activePage, setActivePage] = useState("dashboard");
  const [showAddClient, setShowAddClient] = useState(false);
  const { data, isLoading } = useDashboardMetrics();

  const bookings = ((data as Record<string, unknown>)?.upcomingBookings ?? []) as Booking[];

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      {/* Sidebar */}
      <div className="w-[220px] flex-shrink-0">
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-zinc-900 flex-shrink-0" style={{ background: "#050505" }}>
          <div className="text-sm font-medium text-white capitalize">{activePage}</div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-800 text-[11px] text-zinc-500 hover:border-zinc-700 transition-colors" style={{ background: "#111" }}>
              Search
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-600" style={{ background: "#1a1a1a" }}>⌘K</span>
            </button>
            <button
              onClick={() => setShowAddClient(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-black transition-opacity hover:opacity-90"
              style={{ background: "#fff" }}
            >
              + Add client
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <KpiStrip data={data as Record<string, unknown>} isLoading={isLoading} />

          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-sm font-medium text-white">Clients</div>
              <button onClick={() => setShowAddClient(true)} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
                + Add client
              </button>
            </div>
            <ClientCards onAddClient={() => setShowAddClient(true)} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <ActivityFeed />
            <BookingsPanel bookings={bookings} />
          </div>
        </div>
      </div>

      {/* Add Client Modal */}
      {showAddClient && <AddClientModal onClose={() => setShowAddClient(false)} />}
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
