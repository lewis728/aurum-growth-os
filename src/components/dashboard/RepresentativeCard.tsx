"use client";

/**
 * src/components/dashboard/RepresentativeCard.tsx
 *
 * Dashboard panel showing the active AI representative for a selected campaign.
 * Reads blueprintId from props.
 *
 * States:
 *   — Loading
 *   — Empty (no representative configured)
 *   — Configured (shows stats + edit/redeploy buttons)
 */

import React, { useState, useEffect, useCallback } from "react";
import RepresentativeSetup from "@/components/onboarding/RepresentativeSetup";

// ── Types ─────────────────────────────────────────────────────────────────────

type Personality = "PROFESSIONAL" | "WARM" | "DIRECT" | "CONSULTATIVE";

interface AIRepresentative {
  id:                      string;
  blueprintId:             string;
  tenantId:                string;
  repName:                 string;
  personality:             Personality;
  customIntroLine:         string | null;
  customObjectionResponses:Record<string, string>;
  voiceId:                 string | null;
  lastDeployedAt:          string | null;
  createdAt:               string;
  updatedAt:               string;
}

interface CallStats {
  todayCount:      number;
  weekCount:       number;
  lastOutcome:     string | null;
  lastCallTime:    string | null;
}

interface RepresentativeCardProps {
  blueprintId:        string;
  clientBusinessName: string;
}

// ── Personality badge colours ─────────────────────────────────────────────────

const PERSONALITY_STYLES: Record<Personality, { label: string; classes: string }> = {
  PROFESSIONAL: { label: "Professional", classes: "bg-yellow-100 text-yellow-800 border border-yellow-300" },
  WARM:         { label: "Warm",         classes: "bg-blue-100 text-blue-800 border border-blue-300" },
  DIRECT:       { label: "Direct",       classes: "bg-green-100 text-green-800 border border-green-300" },
  CONSULTATIVE: { label: "Consultative", classes: "bg-purple-100 text-purple-800 border border-purple-300" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string | null): string {
  if (!isoDate) return "Never";
  const diffMs   = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1)   return "Just now";
  if (diffMins < 60)  return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)   return `${diffHrs} hour${diffHrs === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatCallTime(isoDate: string | null): string {
  if (!isoDate) return "—";
  return new Date(isoDate).toLocaleString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RepresentativeCard({
  blueprintId,
  clientBusinessName,
}: RepresentativeCardProps) {
  const [representative, setRepresentative] = useState<AIRepresentative | null>(null);
  const [callStats, setCallStats]           = useState<CallStats | null>(null);
  const [loading, setLoading]               = useState(true);
  const [deploying, setDeploying]           = useState(false);
  const [deployMsg, setDeployMsg]           = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  // ── Fetch representative ────────────────────────────────────────────────────
  const fetchRepresentative = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/representative?blueprintId=${encodeURIComponent(blueprintId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AIRepresentative | null;
      setRepresentative(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load representative");
    } finally {
      setLoading(false);
    }
  }, [blueprintId]);

  // ── Fetch call stats ────────────────────────────────────────────────────────
  const fetchCallStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/representative/stats?blueprintId=${encodeURIComponent(blueprintId)}`);
      if (!res.ok) return;
      const data = await res.json() as CallStats;
      setCallStats(data);
    } catch {
      // Non-fatal — stats are supplementary
    }
  }, [blueprintId]);

  useEffect(() => {
    void fetchRepresentative();
    void fetchCallStats();
  }, [fetchRepresentative, fetchCallStats]);

  // ── Redeploy ────────────────────────────────────────────────────────────────
  async function handleRedeploy() {
    setDeploying(true);
    setDeployMsg(null);
    try {
      const res = await fetch("/api/representative/deploy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ blueprintId }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDeployMsg("Deployed ✓");
      await fetchRepresentative();
      setTimeout(() => setDeployMsg(null), 3000);
    } catch (err) {
      setDeployMsg(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 animate-pulse space-y-3">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-8 bg-gray-200 rounded w-1/2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-700">{error}</p>
        <button
          onClick={() => void fetchRepresentative()}
          className="mt-2 text-sm text-red-600 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!representative) {
    return (
      <>
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center space-y-3">
          <div className="text-3xl">🤖</div>
          <p className="text-gray-600 font-medium">No representative configured for this campaign yet.</p>
          <p className="text-sm text-gray-400">
            Set up a named representative to personalise every call for {clientBusinessName}.
          </p>
          <button
            onClick={() => setDrawerOpen(true)}
            className="mt-2 px-5 py-2 rounded-lg bg-yellow-500 text-white font-semibold hover:bg-yellow-600 transition-colors"
          >
            Set Up Representative
          </button>
        </div>

        {drawerOpen && (
          <Drawer onClose={() => setDrawerOpen(false)}>
            <RepresentativeSetup
              blueprintId={blueprintId}
              clientBusinessName={clientBusinessName}
              onComplete={() => {
                setDrawerOpen(false);
                void fetchRepresentative();
              }}
            />
          </Drawer>
        )}
      </>
    );
  }

  // ── Configured state ────────────────────────────────────────────────────────
  const badge = PERSONALITY_STYLES[representative.personality] ?? PERSONALITY_STYLES.PROFESSIONAL;

  return (
    <>
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Representative</p>
            <h3 className="text-2xl font-bold text-gray-900 mt-0.5">{representative.repName}</h3>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${badge.classes}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-xs text-gray-400 text-right">
            <div>Last updated</div>
            <div className="font-medium text-gray-600">{formatTimeAgo(representative.lastDeployedAt)}</div>
          </div>
        </div>

        {/* Call stats */}
        <div className="grid grid-cols-2 gap-4">
          <StatBox label="Today's calls"    value={callStats?.todayCount ?? "—"} />
          <StatBox label="This week"        value={callStats?.weekCount  ?? "—"} />
          <StatBox label="Last outcome"     value={callStats?.lastOutcome ?? "—"} />
          <StatBox label="Last call"        value={formatCallTime(callStats?.lastCallTime ?? null)} small />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Edit Representative
          </button>
          <button
            onClick={() => void handleRedeploy()}
            disabled={deploying}
            className="flex-1 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 disabled:opacity-50 transition-colors"
          >
            {deploying ? "Deploying…" : deployMsg ?? "Redeploy"}
          </button>
        </div>
      </div>

      {/* Edit drawer */}
      {drawerOpen && (
        <Drawer onClose={() => setDrawerOpen(false)}>
          <RepresentativeSetup
            blueprintId={blueprintId}
            clientBusinessName={clientBusinessName}
            initialValues={{
              repName:         representative.repName,
              personality:     representative.personality,
              customIntroLine: representative.customIntroLine ?? "",
            }}
            onComplete={() => {
              setDrawerOpen(false);
              void fetchRepresentative();
            }}
          />
        </Drawer>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBox({
  label,
  value,
  small = false,
}: {
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-xl p-3">
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <p className={`font-semibold text-gray-900 mt-0.5 ${small ? "text-sm" : "text-lg"}`}>
        {value}
      </p>
    </div>
  );
}

function Drawer({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose:  () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative ml-auto w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl font-bold"
          aria-label="Close"
        >
          ×
        </button>
        <div className="mt-6">
          {children}
        </div>
      </div>
    </div>
  );
}
