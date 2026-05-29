"use client";
/**
 * src/components/dashboard/ActiveCampaignsFeed.tsx
 * Lists all client campaigns for the tenant.
 * Data fetched via useCampaigns() SWR hook (60s poll).
 * Pause/resume via PATCH /api/campaigns/[id]/status.
 *
 * CLIENT-SIDE ONLY. Never import Prisma, OpenAI, Twilio, or Retell here.
 */
import { useState, useCallback } from "react";
import { useCampaigns }          from "@/hooks/useCampaigns";
import { VERTICAL_DISPLAY_NAMES, CampaignStatus } from "@/enums/campaignEnums";
import type { ServiceVertical }  from "@/enums/campaignEnums";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCurrency(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style:    "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  }).format(new Date(iso));
}

// ── Status badge ──────────────────────────────────────────────────────────────
interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const map: Record<string, { label: string; classes: string }> = {
    [CampaignStatus.LIVE]:       { label: "Live",       classes: "bg-green-50 text-green-700 border-green-100" },
    [CampaignStatus.PAUSED]:     { label: "Paused",     classes: "bg-amber-50 text-amber-700 border-amber-100" },
    [CampaignStatus.PENDING]:    { label: "Pending",    classes: "bg-gray-50 text-gray-600 border-gray-100" },
    [CampaignStatus.GENERATING]: { label: "Generating", classes: "bg-blue-50 text-blue-700 border-blue-100" },
    [CampaignStatus.DEPLOYING]:  { label: "Deploying",  classes: "bg-purple-50 text-purple-700 border-purple-100" },
    [CampaignStatus.FAILED]:     { label: "Failed",     classes: "bg-red-50 text-red-700 border-red-100" },
    [CampaignStatus.ARCHIVED]:   { label: "Archived",   classes: "bg-gray-50 text-gray-400 border-gray-100" },
  };
  const cfg = map[status] ?? { label: status, classes: "bg-gray-50 text-gray-600 border-gray-100" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.classes}`}>
      {status === CampaignStatus.LIVE && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {cfg.label}
    </span>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard(): JSX.Element {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="h-4 bg-gray-100 rounded w-36 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-24" />
        </div>
        <div className="h-5 bg-gray-100 rounded-full w-14" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-3">
            <div className="h-3 bg-gray-100 rounded w-12 mb-1" />
            <div className="h-5 bg-gray-100 rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Campaign row data type (from Prisma) ──────────────────────────────────────
interface CampaignRow {
  id:            string;
  status:        string;
  vertical:      string;
  businessName:  string;
  targetLocation: string;
  dailyBudgetUsd: number;
  createdAt:     string;
  updatedAt:     string;
}

// ── Campaign card ─────────────────────────────────────────────────────────────
interface CampaignCardProps {
  campaign:  CampaignRow;
  onToggle:  (id: string, action: "pause" | "resume") => Promise<void>;
  toggling:  boolean;
}

function CampaignCard({ campaign, onToggle, toggling }: CampaignCardProps): JSX.Element {
  const verticalLabel =
    VERTICAL_DISPLAY_NAMES[campaign.vertical as ServiceVertical] ?? campaign.vertical;

  const canPause  = campaign.status === CampaignStatus.LIVE;
  const canResume = campaign.status === CampaignStatus.PAUSED;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 hover:border-gray-200 hover:shadow-sm transition-all duration-150">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{campaign.businessName}</h3>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{verticalLabel} · {campaign.targetLocation}</p>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 mb-1">Daily budget</p>
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(campaign.dailyBudgetUsd)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 mb-1">Monthly cap</p>
          <p className="text-sm font-semibold text-gray-900">{formatCurrency(campaign.dailyBudgetUsd * 30.5)}</p>
        </div>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Started {formatDate(campaign.createdAt)}</p>
        <div className="flex items-center gap-2">
          {canPause && (
            <button
              onClick={() => void onToggle(campaign.id, "pause")}
              disabled={toggling}
              className="text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-100 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {toggling ? "…" : "Pause"}
            </button>
          )}
          {canResume && (
            <button
              onClick={() => void onToggle(campaign.id, "resume")}
              disabled={toggling}
              className="text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-100 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {toggling ? "…" : "Resume"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ActiveCampaignsFeed(): JSX.Element {
  const { campaigns, isLoading, error, mutate } = useCampaigns();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggle = useCallback(async (id: string, action: "pause" | "resume") => {
    setTogglingId(id);
    setToggleError(null);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}/status`, {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ action }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(text);
      }
      await mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update campaign";
      setToggleError(msg);
    } finally {
      setTogglingId(null);
    }
  }, [mutate]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Client Campaigns</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {isLoading ? "Loading…" : `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {!isLoading && campaigns.length > 0 && (
          <span className="text-xs text-gray-400">Auto-refreshes every 60s</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">
        {/* Toggle error */}
        {toggleError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            {toggleError}
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {/* Fetch error */}
        {!isLoading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">Could not load campaigns</p>
            <p className="text-xs text-gray-400 mt-1">{error.message}</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center mb-3">
              <svg className="w-5 h-5" style={{ color: "#C9A84C" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">No client campaigns yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Use the Command Centre to launch your first campaign.
            </p>
          </div>
        )}

        {/* Campaign cards */}
        {!isLoading && !error && (campaigns as unknown as CampaignRow[]).map((campaign) => (
          <CampaignCard
            key={campaign.id}
            campaign={campaign as unknown as CampaignRow}
            onToggle={handleToggle}
            toggling={togglingId === campaign.id}
          />
        ))}
      </div>
    </div>
  );
}
