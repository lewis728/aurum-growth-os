"use client";
/**
 * src/components/dashboard/ReportCard.tsx
 *
 * Monthly performance report viewer for the agency owner's dashboard.
 * Fetches from GET /api/reports on mount.
 * Full report HTML displayed in a full-screen modal/drawer.
 *
 * States:
 *   LOADING   — skeleton card
 *   NO REPORTS — empty state with auto-generation explanation
 *   HAS REPORTS — current month summary + previous reports accordion
 *   ERROR     — "Unable to load reports — please refresh."
 *
 * No tier messaging. No upgrade prompts.
 * Design: white background, Aurum gold #C9A84C accent, Inter font.
 */

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReportListItem {
  id:          string;
  month:       number;
  year:        number;
  generatedAt: string;
  emailedAt:   string | null;
}

interface ReportFull extends ReportListItem {
  reportHtml: string;
  reportData: unknown;
}

interface ReportTotals {
  totalLeads:    number;
  totalBooked:   number;
  totalSpendGbp: number;
  avgCplGbp:     number | null;
}

// ── Month name helper ─────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthName(month: number): string {
  return MONTH_NAMES[(month - 1) % 12] ?? String(month);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton(): JSX.Element {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-6 w-1/3 rounded-lg bg-gray-100" />
      <div className="h-24 rounded-xl bg-gray-100" />
      <div className="h-10 rounded-lg bg-gray-100" />
      <div className="h-10 rounded-lg bg-gray-100" />
    </div>
  );
}

// ── Report Modal ──────────────────────────────────────────────────────────────
interface ReportModalProps {
  report:   ReportFull;
  onClose:  () => void;
}

function ReportModal({ report, onClose }: ReportModalProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-bold text-[#111827]">
            {monthName(report.month)} {report.year} Performance Report
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#111827] transition-colors"
            aria-label="Close report"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Report HTML */}
        <div
          className="px-6 py-6 overflow-auto"
          dangerouslySetInnerHTML={{ __html: report.reportHtml }}
        />
        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-[#9CA3AF]">
            Generated {formatDate(report.generatedAt)}
            {report.emailedAt ? ` · Emailed ${formatDate(report.emailedAt)}` : ""}
          </p>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[#374151] hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ReportCard(): JSX.Element {
  const [reports,       setReports]       = useState<ReportListItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [activeReport,  setActiveReport]  = useState<ReportFull | null>(null);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const [accordionOpen, setAccordionOpen] = useState(false);

  // ── Fetch report list ─────────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/reports?limit=12&offset=0");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { reports: ReportListItem[] };
        setReports(data.reports);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Open full report ──────────────────────────────────────────────────────
  const openReport = useCallback(async (reportId: string) => {
    setLoadingReport(reportId);
    try {
      const res = await fetch(`/api/reports/${reportId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ReportFull;
      setActiveReport(data);
    } catch (err) {
      console.error("[ReportCard] Failed to load report:", err);
    } finally {
      setLoadingReport(null);
    }
  }, []);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6">
        <Skeleton />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6">
        <p className="text-sm text-[#6B7280]">Unable to load reports — please refresh.</p>
      </div>
    );
  }

  // ── No reports yet ────────────────────────────────────────────────────────
  if (reports.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6">
        <div className="flex items-start gap-4">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: "#C9A84C1A" }}
          >
            <svg
              className="h-5 w-5"
              style={{ color: "#C9A84C" }}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#111827]">
              No performance reports yet
            </p>
            <p className="mt-1 text-xs text-[#6B7280] leading-relaxed">
              Your first performance report will be generated automatically on the 1st of
              next month. It will cover all your active client campaigns and be emailed
              directly to you.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Has reports ───────────────────────────────────────────────────────────
  const latest = reports[0]!;
  const previous = reports.slice(1);

  // Extract top-level metrics from latest reportData if available
  const latestTotals = null as ReportTotals | null; // populated via full fetch if needed

  return (
    <>
      {/* Modal */}
      {activeReport && (
        <ReportModal
          report={activeReport}
          onClose={() => setActiveReport(null)}
        />
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-6 space-y-5">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#111827] uppercase tracking-wide">
            Performance Reports
          </h3>
          <span className="text-xs text-[#9CA3AF]">Auto-generated monthly</span>
        </div>

        {/* Latest report card */}
        <div className="rounded-xl border border-gray-100 bg-[#FAFAF9] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#111827]">
                {monthName(latest.month)} {latest.year}
              </p>
              <p className="text-xs text-[#6B7280] mt-0.5">
                Generated {formatDate(latest.generatedAt)}
                {latest.emailedAt
                  ? ` · Emailed ${formatDate(latest.emailedAt)}`
                  : " · Email pending"}
              </p>
            </div>
            <button
              onClick={() => void openReport(latest.id)}
              disabled={loadingReport === latest.id}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: "#C9A84C" }}
            >
              {loadingReport === latest.id ? (
                <>
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Loading…
                </>
              ) : (
                "View Full Report"
              )}
            </button>
          </div>

          {/* Top-level metrics placeholder — populated if latestTotals loaded */}
          {latestTotals && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Metric label="Total Leads"  value={String(latestTotals.totalLeads)} />
              <Metric label="Total Spend"  value={`£${latestTotals.totalSpendGbp.toFixed(2)}`} />
              <Metric label="Avg CPL"      value={latestTotals.avgCplGbp != null ? `£${latestTotals.avgCplGbp.toFixed(2)}` : "—"} />
            </div>
          )}
        </div>

        {/* Previous reports accordion */}
        {previous.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setAccordionOpen((o) => !o)}
              className="flex w-full items-center justify-between text-xs font-semibold text-[#374151] hover:text-[#111827] transition-colors"
            >
              <span>Previous Reports ({previous.length})</span>
              <svg
                className={`h-4 w-4 transition-transform ${accordionOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {accordionOpen && (
              <div className="mt-3 space-y-2">
                {previous.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5"
                  >
                    <div>
                      <p className="text-xs font-medium text-[#111827]">
                        {monthName(r.month)} {r.year}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">
                        Generated {formatDate(r.generatedAt)}
                        {r.emailedAt ? ` · Emailed` : " · Pending"}
                      </p>
                    </div>
                    <button
                      onClick={() => void openReport(r.id)}
                      disabled={loadingReport === r.id}
                      className="text-xs font-medium text-[#C9A84C] hover:underline disabled:opacity-50"
                    >
                      {loadingReport === r.id ? "Loading…" : "View"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Metric tile ───────────────────────────────────────────────────────────────
function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-center">
      <p className="text-xs font-semibold text-[#111827]">{value}</p>
      <p className="text-xs text-[#9CA3AF] mt-0.5">{label}</p>
    </div>
  );
}
