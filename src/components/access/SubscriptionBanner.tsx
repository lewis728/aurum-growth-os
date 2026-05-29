/**
 * src/components/access/SubscriptionBanner.tsx
 *
 * Renders a banner (or full-screen overlay) at the top of the dashboard
 * based on the current subscription state.
 *
 * States:
 *   none       → Full-screen overlay with "Start free trial" CTA
 *   trialing   → Amber banner with trial countdown and seat availability
 *   active     → Nothing rendered
 *   past_due   → Red banner with "Fix billing" button
 *
 * "use client" — uses useSubscriptionAccess() which polls /api/billing/status
 */

"use client";

import { useState } from "react";
import { useSubscriptionAccess } from "@/hooks/useSubscriptionAccess";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(date: Date): number {
  const now = Date.now();
  const diff = date.getTime() - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SubscriptionBanner() {
  const { state, seatCount, trialEndsAt, isLoading } = useSubscriptionAccess();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Don't render anything while loading or when active (clean dashboard)
  if (isLoading || state === "active") return null;

  // ── Checkout handler ────────────────────────────────────────────────────────
  async function handleStartTrial() {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        console.error("[SubscriptionBanner] Checkout error:", data.error);
      }
    } catch (err) {
      console.error("[SubscriptionBanner] Checkout fetch failed:", err);
    } finally {
      setCheckoutLoading(false);
    }
  }

  // ── Portal handler ──────────────────────────────────────────────────────────
  async function handleFixBilling() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        console.error("[SubscriptionBanner] Portal error:", data.error);
      }
    } catch (err) {
      console.error("[SubscriptionBanner] Portal fetch failed:", err);
    } finally {
      setPortalLoading(false);
    }
  }

  // ── STATE: none — full-screen overlay ──────────────────────────────────────
  if (state === "none") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backdropFilter: "blur(6px)", backgroundColor: "rgba(255,255,255,0.85)" }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-10 max-w-md w-full mx-4 text-center">
          {/* Aurum wordmark */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded"
              style={{ backgroundColor: "#C9A84C", color: "#FFFFFF" }}
            >
              AURUM
            </span>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 mb-3">
            Welcome to Aurum Growth OS
          </h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed">
            Start your 14-day free trial to launch your first client campaign.
            No setup fee. Cancel anytime.
          </p>

          <div className="bg-gray-50 rounded-xl p-4 mb-8 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Platform fee</span>
              <span className="text-gray-900 font-medium">£97 / month</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Per client seat</span>
              <span className="text-gray-900 font-medium">£500 / month</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Ad spend fee</span>
              <span className="text-gray-900 font-medium">5% of spend</span>
            </div>
            <div className="border-t border-gray-200 pt-2 flex justify-between text-sm">
              <span className="text-gray-500">Trial period</span>
              <span className="font-semibold" style={{ color: "#C9A84C" }}>14 days free</span>
            </div>
          </div>

          <button
            onClick={handleStartTrial}
            disabled={checkoutLoading}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-opacity disabled:opacity-60"
            style={{ backgroundColor: "#C9A84C" }}
          >
            {checkoutLoading ? "Redirecting to checkout…" : "Start your free trial"}
          </button>
        </div>
      </div>
    );
  }

  // ── STATE: trialing ─────────────────────────────────────────────────────────
  if (state === "trialing") {
    const TRIAL_CAP = 3;
    const slotsRemaining = TRIAL_CAP - seatCount;
    const daysLeft = trialEndsAt ? daysUntil(trialEndsAt) : null;
    const atCap = seatCount >= TRIAL_CAP;

    return (
      <div
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm"
        style={{ backgroundColor: "#FFFBEB", borderBottom: "1px solid #FDE68A" }}
      >
        <span className="text-amber-800">
          {atCap ? (
            <>
              <strong>You&apos;ve used all 3 trial client slots.</strong> Subscribe to add unlimited clients.
            </>
          ) : (
            <>
              Trial active
              {daysLeft !== null && (
                <> — <strong>{daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining</strong></>
              )}
              . <strong>{slotsRemaining} client slot{slotsRemaining !== 1 ? "s" : ""}</strong> available.
            </>
          )}
        </span>

        <button
          onClick={handleStartTrial}
          disabled={checkoutLoading}
          className="ml-4 px-3 py-1 rounded-lg text-white text-xs font-semibold transition-opacity disabled:opacity-60 shrink-0"
          style={{ backgroundColor: "#C9A84C" }}
        >
          {checkoutLoading ? "Loading…" : "Subscribe now"}
        </button>
      </div>
    );
  }

  // ── STATE: past_due ─────────────────────────────────────────────────────────
  if (state === "past_due") {
    return (
      <div
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm"
        style={{ backgroundColor: "#FEF2F2", borderBottom: "1px solid #FECACA" }}
      >
        <span className="text-red-800">
          <strong>Payment failed</strong> — your campaigns are paused. Update your payment method to resume.
        </span>

        <button
          onClick={handleFixBilling}
          disabled={portalLoading}
          className="ml-4 px-3 py-1 rounded-lg text-white text-xs font-semibold transition-opacity disabled:opacity-60 shrink-0"
          style={{ backgroundColor: "#DC2626" }}
        >
          {portalLoading ? "Loading…" : "Fix billing"}
        </button>
      </div>
    );
  }

  return null;
}
