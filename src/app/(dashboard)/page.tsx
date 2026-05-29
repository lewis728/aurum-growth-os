"use client";
/**
 * src/app/(dashboard)/page.tsx
 * Aurum Growth OS — Main Dashboard
 *
 * Layout (desktop):
 *   Row 1: Topbar — Aurum wordmark · ClientSelector · UserButton
 *   Row 2: HeroMetrics (4 KPI tiles)
 *   Row 3: Left 40% ChatWorkspace | Right 60% SpendChart + CampaignHealthGrid
 *   Row 4: LiveCallFeed (full width)
 *   Row 5: BookingTimeline (full width)
 *
 * Mobile: tab switcher — Command / Campaigns / Bookings
 * Auth-gated via Clerk <SignedIn> / <SignedOut>.
 */
import { useState }                                          from "react";
import { SignedIn, SignedOut, RedirectToSignIn, UserButton } from "@clerk/nextjs";

import ChatWorkspace         from "@/components/dashboard/ChatWorkspace";
import ActiveCampaignsFeed   from "@/components/dashboard/ActiveCampaignsFeed";
import LeadDesk              from "@/components/dashboard/LeadDesk";
import { HeroMetrics }       from "@/components/dashboard/HeroMetrics";
import { ClientSelector }    from "@/components/dashboard/ClientSelector";
import { LiveCallFeed }      from "@/components/dashboard/LiveCallFeed";
import { BookingTimeline }   from "@/components/dashboard/BookingTimeline";
import { CampaignHealthGrid } from "@/components/dashboard/CampaignHealthGrid";
import { SpendChart }        from "@/components/dashboard/SpendChart";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";

// ── Aurum wordmark ─────────────────────────────────────────────────────────────
function AurumWordmark(): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: "#C9A84C" }}
      >
        <span className="text-xs font-bold text-white">A</span>
      </div>
      <div>
        <span className="text-sm font-bold text-[#111827] tracking-tight">Aurum</span>
        <span className="text-sm font-normal text-[#9CA3AF] ml-1 tracking-tight">Growth OS</span>
      </div>
    </div>
  );
}

// ── Mobile tab switcher ────────────────────────────────────────────────────────
const MOBILE_TABS = [
  { id: "chat",      label: "Command"   },
  { id: "campaigns", label: "Campaigns" },
  { id: "bookings",  label: "Bookings"  },
] as const;
type MobileTab = (typeof MOBILE_TABS)[number]["id"];

function MobileView(): JSX.Element {
  const [activeTab, setActiveTab] = useState<MobileTab>("chat");
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-[#F3F4F6] bg-white">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-[#C9A84C] text-[#111827]"
                : "text-[#9CA3AF] hover:text-[#6B7280]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "chat"      && <ChatWorkspace />}
        {activeTab === "campaigns" && (
          <div className="p-4 space-y-4">
            <ActiveCampaignsFeed />
          </div>
        )}
        {activeTab === "bookings"  && (
          <div className="p-4">
            <LeadDesk />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Desktop dashboard ──────────────────────────────────────────────────────────
function DesktopDashboard(): JSX.Element {
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | undefined>(undefined);
  const { data, isLoading } = useDashboardMetrics(selectedBlueprintId);

  return (
    <div className="flex flex-col min-h-screen bg-[#F9FAFB]">
      {/* Row 1 — Topbar */}
      <header className="flex-shrink-0 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <AurumWordmark />
        <ClientSelector
          selectedBlueprintId={selectedBlueprintId}
          onChange={setSelectedBlueprintId}
        />
        <UserButton afterSignOutUrl="/" />
      </header>

      {/* Scrollable content */}
      <main className="flex-1 overflow-auto px-6 py-6 space-y-6">
        {/* Row 2 — Hero KPIs */}
        <HeroMetrics
          data={data?.heroMetrics}
          isLoading={isLoading}
        />

        {/* Row 3 — Chat + Spend/Health */}
        <div className="grid grid-cols-5 gap-6" style={{ minHeight: "520px" }}>
          {/* Left: Command Centre (40%) */}
          <div className="col-span-2 flex flex-col">
            <ChatWorkspace />
          </div>

          {/* Right: SpendChart stacked above CampaignHealthGrid (60%) */}
          <div className="col-span-3 flex flex-col gap-6">
            <SpendChart
              days={data?.spendChart ?? []}
              isLoading={isLoading}
            />
            <CampaignHealthGrid
              rows={data?.campaignHealth ?? []}
              isLoading={isLoading}
              onSelectClient={(id) => setSelectedBlueprintId(id)}
            />
          </div>
        </div>

        {/* Row 4 — Live Call Feed */}
        <LiveCallFeed
          calls={data?.recentCalls ?? []}
          isLoading={isLoading}
        />

        {/* Row 5 — Booking Timeline */}
        <BookingTimeline
          bookings={data?.upcomingBookings ?? []}
          isLoading={isLoading}
        />
      </main>
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────────
export default function DashboardPage(): JSX.Element {
  return (
    <>
      <SignedIn>
        {/* Desktop */}
        <div className="hidden md:flex flex-col h-screen overflow-hidden">
          <DesktopDashboard />
        </div>
        {/* Mobile */}
        <div className="flex md:hidden flex-col h-screen overflow-hidden">
          <MobileView />
        </div>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
