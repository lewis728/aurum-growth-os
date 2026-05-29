/**
 * src/components/dashboard/BudgetControl.tsx
 *
 * Inline budget editor for a single client campaign card.
 * Sits inside ActiveCampaignsFeed — clearly scoped per client card.
 *
 * States:
 *   display  → shows "Client daily budget: £X/day" + Edit button
 *   editing  → number input with ±£10 step buttons + Save / Cancel
 *   saving   → "Saving…" spinner, input disabled
 *   warning  → 20% rule modal before proceeding
 *
 * "use client" — all state is local; PATCH calls go to /api/campaigns/[id]/budget
 */

"use client";

import { useState, useRef, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BudgetControlProps {
  blueprintId: string;
  /** Current daily budget in GBP (derived from dailyUsd / GBPUSD_RATE on the server) */
  currentDailyBudgetGbp: number;
  /** Called after a successful save so the parent (ActiveCampaignsFeed) can revalidate */
  onBudgetUpdated: (newBudgetGbp: number) => void;
}

interface TwentyPercentWarning {
  warning: "20_PERCENT_RULE";
  safeIncrease: number;
  requestedIncrease: number;
  message: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP = 10;
const MIN_BUDGET = 10;

// ─── Component ────────────────────────────────────────────────────────────────

export function BudgetControl({
  blueprintId,
  currentDailyBudgetGbp,
  onBudgetUpdated,
}: BudgetControlProps) {
  const [mode, setMode] = useState<"display" | "editing" | "saving">("display");
  const [inputValue, setInputValue] = useState<number>(currentDailyBudgetGbp);
  const [displayBudget, setDisplayBudget] = useState<number>(currentDailyBudgetGbp);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<TwentyPercentWarning | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync if parent updates the budget (e.g. after revalidation)
  useEffect(() => {
    setDisplayBudget(currentDailyBudgetGbp);
    if (mode === "display") setInputValue(currentDailyBudgetGbp);
  }, [currentDailyBudgetGbp, mode]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (mode === "editing") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [mode]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleEdit() {
    setInputValue(displayBudget);
    setError(null);
    setMode("editing");
  }

  function handleCancel() {
    setInputValue(displayBudget);
    setError(null);
    setMode("display");
  }

  function handleIncrement() {
    setInputValue((v) => Math.max(MIN_BUDGET, v + STEP));
    setError(null);
  }

  function handleDecrement() {
    setInputValue((v) => Math.max(MIN_BUDGET, v - STEP));
    setError(null);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) setInputValue(val);
    setError(null);
  }

  async function submitBudget(budgetGbp: number, force: boolean) {
    if (budgetGbp < MIN_BUDGET) {
      setError(`Client daily budget must be at least £${MIN_BUDGET}/day`);
      return;
    }

    setMode("saving");
    setError(null);

    try {
      const res = await fetch(`/api/campaigns/${blueprintId}/budget`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyBudgetGbp: budgetGbp, force }),
      });

      const data = (await res.json()) as
        | TwentyPercentWarning
        | { blueprint: unknown; message: string }
        | { error: string };

      if (!res.ok) {
        const errMsg = "error" in data ? data.error : `HTTP ${res.status}`;
        setError(errMsg);
        setMode("editing");
        return;
      }

      // 20% rule warning — show modal, don't commit yet
      if ("warning" in data && data.warning === "20_PERCENT_RULE") {
        setWarning(data as TwentyPercentWarning);
        setMode("editing");
        return;
      }

      // Success — optimistic update
      setDisplayBudget(budgetGbp);
      setMode("display");
      onBudgetUpdated(budgetGbp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg);
      setMode("editing");
    }
  }

  async function handleSave() {
    await submitBudget(inputValue, false);
  }

  async function handleApplySafeIncrease() {
    if (!warning) return;
    setWarning(null);
    await submitBudget(warning.safeIncrease, false);
  }

  async function handleOverrideAnyway() {
    if (!warning) return;
    const requested = warning.requestedIncrease;
    setWarning(null);
    await submitBudget(requested, true);
  }

  const isDirty = inputValue !== displayBudget;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {/* Label — clearly scoped to this client card */}
      <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">
        Client daily budget
      </p>

      {/* ── Display mode ─────────────────────────────────────────────────── */}
      {mode === "display" && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">
            £{displayBudget.toFixed(2)}<span className="text-gray-400 font-normal"> / day</span>
          </span>
          <button
            onClick={handleEdit}
            className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 transition-colors"
          >
            Edit
          </button>
        </div>
      )}

      {/* ── Editing / Saving mode ─────────────────────────────────────────── */}
      {(mode === "editing" || mode === "saving") && (
        <div className="space-y-2">
          {/* Input row */}
          <div className="flex items-center gap-1.5">
            {/* Decrement */}
            <button
              onClick={handleDecrement}
              disabled={mode === "saving" || inputValue <= MIN_BUDGET}
              className="w-7 h-7 rounded-md border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 flex items-center justify-center text-sm font-medium transition-colors"
              aria-label="Decrease budget by £10"
            >
              −
            </button>

            {/* £ prefix + input */}
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-500 pointer-events-none">
                £
              </span>
              <input
                ref={inputRef}
                type="number"
                min={MIN_BUDGET}
                step={STEP}
                value={inputValue}
                onChange={handleInputChange}
                disabled={mode === "saving"}
                className="w-full pl-6 pr-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 disabled:bg-gray-50 disabled:text-gray-400"
                style={{ focusRingColor: "#C9A84C" } as React.CSSProperties}
                onFocus={(e) => {
                  e.target.style.borderColor = "#C9A84C";
                  e.target.style.boxShadow = "0 0 0 2px rgba(201,168,76,0.2)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "";
                  e.target.style.boxShadow = "";
                }}
              />
            </div>

            {/* Increment */}
            <button
              onClick={handleIncrement}
              disabled={mode === "saving"}
              className="w-7 h-7 rounded-md border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40 flex items-center justify-center text-sm font-medium transition-colors"
              aria-label="Increase budget by £10"
            >
              +
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!isDirty || mode === "saving"}
              className="flex-1 py-1.5 rounded-md text-white text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ backgroundColor: "#C9A84C" }}
            >
              {mode === "saving" ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={mode === "saving"}
              className="flex-1 py-1.5 rounded-md border border-gray-200 text-gray-600 text-xs font-medium hover:border-gray-300 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>

          {/* Inline error */}
          {error && (
            <p className="text-xs text-red-600 mt-1">{error}</p>
          )}
        </div>
      )}

      {/* ── 20% Rule Warning Modal ────────────────────────────────────────── */}
      {warning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
                style={{ backgroundColor: "#C9A84C" }}
              >
                !
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">
                  Meta Algorithm Warning
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {warning.message}
                </p>
              </div>
            </div>

            <div className="bg-amber-50 rounded-xl p-3 mb-4 text-xs text-amber-800">
              <strong>Increasing your client&apos;s budget by more than 20%</strong> resets the
              Meta algorithm learning phase. This can temporarily increase CPL while the
              algorithm re-optimises.
            </div>

            <div className="space-y-2">
              <button
                onClick={handleApplySafeIncrease}
                className="w-full py-2.5 rounded-xl text-white text-sm font-semibold transition-opacity"
                style={{ backgroundColor: "#C9A84C" }}
              >
                Apply Safe Increase (£{warning.safeIncrease.toFixed(2)}/day)
              </button>
              <button
                onClick={handleOverrideAnyway}
                className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:border-gray-300 transition-colors"
              >
                Override Anyway (£{warning.requestedIncrease.toFixed(2)}/day)
              </button>
              <button
                onClick={() => setWarning(null)}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
