/**
 * src/components/billing/BillingCard.tsx
 * "use client" — three states: not subscribed, trialing, active.
 * White background, Aurum gold accent, Inter font.
 * Agency-owner copy throughout.
 */
"use client";

import { useState } from "react";
import { useBillingStatus } from "@/hooks/useBillingStatus";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        No subscription
      </span>
    );
  }

  const map: Record<string, { bg: string; dot: string; text: string; label: string }> = {
    active: { bg: "bg-emerald-50", dot: "bg-emerald-500", text: "text-emerald-700", label: "Active" },
    trialing: { bg: "bg-amber-50", dot: "bg-amber-400", text: "text-amber-700", label: "Trial" },
    past_due: { bg: "bg-red-50", dot: "bg-red-500", text: "text-red-700", label: "Past due" },
    canceled: { bg: "bg-gray-100", dot: "bg-gray-400", text: "text-gray-600", label: "Canceled" },
  };

  const style = map[status] ?? map.canceled;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

export function BillingCard() {
  const { billing, isLoading, refetch } = useBillingStatus();
  const [isRedirecting, setIsRedirecting] = useState(false);

  async function handleSubscribe() {
    setIsRedirecting(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        console.error("[BillingCard] Checkout error:", data.error);
      }
    } catch (err) {
      console.error("[BillingCard] Checkout fetch error:", err);
    } finally {
      setIsRedirecting(false);
      setTimeout(() => void refetch(), 3000);
    }
  }

  async function handleManage() {
    setIsRedirecting(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        console.error("[BillingCard] Portal error:", data.error);
      }
    } catch (err) {
      console.error("[BillingCard] Portal fetch error:", err);
    } finally {
      setIsRedirecting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
        <div className="mt-3 h-3 w-48 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  const subscribed = billing?.subscribed ?? false;
  const isTrialing = billing?.status === "trialing";
  const isPastDue = billing?.status === "past_due";

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Aurum Platform</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {subscribed
              ? `${billing?.seatCount ?? 0} active client ${billing?.seatCount === 1 ? "seat" : "seats"}`
              : "Manage your agency subscription"}
          </p>
        </div>
        <StatusBadge status={billing?.status ?? null} />
      </div>

      {/* Pricing breakdown */}
      <div className="mt-4 space-y-1.5 rounded-xl bg-gray-50 p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Platform access</span>
          <span className="font-medium text-gray-900">£97 / month</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Per client seat</span>
          <span className="font-medium text-gray-900">£500 / month</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Ad spend management fee</span>
          <span className="font-medium text-gray-900">5% of monthly spend</span>
        </div>
      </div>

      {/* Trial / period info */}
      {subscribed && (
        <div className="mt-4 space-y-1">
          {isTrialing && billing?.trialEndsAt && (
            <p className="text-xs text-amber-600">
              Trial ends {formatDate(billing.trialEndsAt)} — add a payment method to continue.
            </p>
          )}
          {!isTrialing && billing?.currentPeriodEnd && (
            <p className="text-xs text-gray-500">
              Next billing date: {formatDate(billing.currentPeriodEnd)}
            </p>
          )}
          {isPastDue && (
            <p className="text-xs font-medium text-red-600">
              Payment overdue — your client campaigns may be paused. Please update your payment method.
            </p>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="mt-5">
        {!subscribed ? (
          <button
            onClick={() => void handleSubscribe()}
            disabled={isRedirecting}
            className="w-full rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isRedirecting ? "Redirecting…" : "Start 14-day free trial"}
          </button>
        ) : (
          <button
            onClick={() => void handleManage()}
            disabled={isRedirecting}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {isRedirecting ? "Redirecting…" : "Manage subscription"}
          </button>
        )}
      </div>

      {/* Month 1 free note */}
      {!subscribed && (
        <p className="mt-3 text-center text-xs text-gray-400">
          Month 1 is free. No setup fee. Cancel anytime.
        </p>
      )}
    </div>
  );
}
