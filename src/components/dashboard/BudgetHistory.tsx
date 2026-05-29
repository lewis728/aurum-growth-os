/**
 * src/components/dashboard/BudgetHistory.tsx
 *
 * Small expandable section below BudgetControl on each client campaign card.
 * Shows the last 10 budget changes from the blueprint's orchestrationLog,
 * filtered by step === 'BUDGET_UPDATED'.
 *
 * Format: "Budget updated for this client · £50 → £100 · 2 days ago"
 *
 * "use client" — purely presentational; receives log entries as props.
 */

"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BudgetLogEntry {
  step: string;
  status: string;
  message: string;
  timestamp: string;
  meta?: {
    previousDailyBudgetGbp?: number;
    newDailyBudgetGbp?: number;
    [key: string]: unknown;
  };
}

interface BudgetHistoryProps {
  /** Full orchestrationLog from the blueprint — component filters internally */
  orchestrationLog: unknown[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days !== 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  return "just now";
}

function isBudgetEntry(entry: unknown): entry is BudgetLogEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry as BudgetLogEntry).step === "BUDGET_UPDATED"
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BudgetHistory({ orchestrationLog }: BudgetHistoryProps) {
  const [expanded, setExpanded] = useState(false);

  // Filter and take last 10 BUDGET_UPDATED entries (most recent first)
  const budgetEntries = orchestrationLog
    .filter(isBudgetEntry)
    .slice(-10)
    .reverse();

  if (budgetEntries.length === 0) return null;

  return (
    <div className="mt-2">
      {/* Toggle button */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Budget history ({budgetEntries.length})
      </button>

      {/* Entries list */}
      {expanded && (
        <ul className="mt-2 space-y-1.5">
          {budgetEntries.map((entry, idx) => {
            const prev = entry.meta?.previousDailyBudgetGbp;
            const next = entry.meta?.newDailyBudgetGbp;
            const hasValues =
              typeof prev === "number" && typeof next === "number";

            return (
              <li
                key={idx}
                className="flex items-start gap-2 text-xs text-gray-500"
              >
                {/* Timeline dot */}
                <span
                  className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: "#C9A84C" }}
                />
                <span className="leading-relaxed">
                  <span className="text-gray-600">Budget updated for this client</span>
                  {hasValues && (
                    <>
                      {" · "}
                      <span className="font-medium text-gray-700">
                        £{(prev as number).toFixed(2)} → £{(next as number).toFixed(2)}
                      </span>
                    </>
                  )}
                  {" · "}
                  <span className="text-gray-400">{timeAgo(entry.timestamp)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
