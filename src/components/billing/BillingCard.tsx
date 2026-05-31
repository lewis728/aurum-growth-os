/**
 * src/components/billing/BillingCard.tsx
 * "use client" — tiered billing: platform fee + per-client seats (Starter £200 /
 * Full service £500). Renders subscription status, seat breakdown, monthly total,
 * per-client upgrade, and checkout / portal CTAs.
 */
"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { useBillingStatus } from "@/hooks/useBillingStatus";

const card: CSSProperties = {
  background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "20px",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function BillingCard() {
  const { billing, isLoading, error, refetch } = useBillingStatus();
  const [busy, setBusy] = useState<string | null>(null);

  if (isLoading) {
    return <div style={card}><div style={{ fontSize: "12px", color: "#444" }}>Loading billing…</div></div>;
  }
  if (error || !billing) {
    return <div style={card}><div style={{ fontSize: "12px", color: "#ef4444" }}>Couldn&apos;t load billing.</div></div>;
  }

  const subscribed = billing.subscribed;
  const isTrialing = billing.status === "trialing";

  async function redirect(endpoint: string, key: string) {
    setBusy(key);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.open(data.url, "_blank");
    } catch {
      /* swallow — button re-enables */
    } finally {
      setBusy(null);
    }
  }

  async function upgrade(blueprintId: string) {
    setBusy(blueprintId);
    try {
      const res = await fetch("/api/clients/upgrade-tier", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ blueprintId }),
      });
      if (res.ok) refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "560px" }}>
      {/* Trial / no-subscription banner */}
      {!subscribed && (
        <div style={{ ...card, borderColor: "rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "13px", color: "#C9A84C", fontWeight: 600 }}>Start your 14-day free trial</div>
              <div style={{ fontSize: "11px", color: "#777", marginTop: "3px" }}>
                Month 1 is free. No setup fee. Cancel anytime.
              </div>
            </div>
            <button
              onClick={() => void redirect("/api/billing/checkout", "checkout")}
              disabled={busy === "checkout"}
              style={{ background: "#C9A84C", color: "#000", fontWeight: 600, fontSize: "12px", padding: "8px 16px", borderRadius: "8px", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {busy === "checkout" ? "Redirecting…" : "Start free trial"}
            </button>
          </div>
        </div>
      )}

      {isTrialing && billing.trialEndsAt && (
        <div style={{ ...card, borderColor: "rgba(201,168,76,0.2)", background: "rgba(201,168,76,0.04)" }}>
          <div style={{ fontSize: "12px", color: "#C9A84C" }}>
            Free trial — ends {fmtDate(billing.trialEndsAt)}. Add a payment method to continue after.
          </div>
        </div>
      )}

      {/* Subscription summary */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff" }}>Subscription</div>
          {subscribed && (
            <button
              onClick={() => void redirect("/api/billing/portal", "portal")}
              disabled={busy === "portal"}
              style={{ fontSize: "11px", color: "#aaa", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "5px 10px", cursor: "pointer" }}
            >
              {busy === "portal" ? "…" : "Manage"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "8px" }}>
          <span className="font-mono" style={{ fontSize: "28px", color: "#fff", fontWeight: 300 }}>£{billing.monthlyTotal}</span>
          <span style={{ fontSize: "12px", color: "#555" }}>/month</span>
        </div>
        <div style={{ fontSize: "11px", color: "#555" }}>
          Status: <span style={{ color: billing.platformActive ? "#22c55e" : "#f59e0b" }}>{billing.status ?? "no subscription"}</span>
          {billing.nextBillingDate && <> · Next billing: <span className="font-mono">{fmtDate(billing.nextBillingDate)}</span></>}
        </div>
      </div>

      {/* Volume pricing (Sprint 11) — current per-client rate + next-tier nudge */}
      {billing.volume && (
        <div style={card}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff", marginBottom: "10px" }}>Volume pricing</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
            <span className="font-mono" style={{ fontSize: "22px", color: "#fff", fontWeight: 300 }}>£{billing.volume.perClientGbp}</span>
            <span style={{ fontSize: "12px", color: "#555" }}>/client · {billing.volume.clientCount} {billing.volume.clientCount === 1 ? "client" : "clients"}</span>
          </div>
          {billing.volume.nextTier ? (
            <div style={{ fontSize: "12px", color: "#C9A84C", marginTop: "8px", lineHeight: 1.5 }}>
              You&apos;re {billing.volume.nextTier.clientsUntil} {billing.volume.nextTier.clientsUntil === 1 ? "client" : "clients"} away from dropping to £{billing.volume.nextTier.perClientGbp}/client — saving £{billing.volume.nextTier.monthlySavingGbp}/month.
            </div>
          ) : (
            <div style={{ fontSize: "12px", color: "#22c55e", marginTop: "8px" }}>
              You&apos;re on the best rate — £{billing.volume.perClientGbp}/client.
            </div>
          )}
        </div>
      )}

      {/* Seat breakdown */}
      <div style={card}>
        <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff", marginBottom: "14px" }}>This month</div>
        {([
          ["Platform fee",                            billing.platformFee],
          [`Starter × ${billing.starterSeats}`,       billing.starterSeats * billing.seatPrices.starter],
          [`Full service × ${billing.fullServiceSeats}`, billing.fullServiceSeats * billing.seatPrices.full_service],
        ] as [string, number][]).map(([label, amount], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "12px", color: "#888" }}>{label}</span>
            <span className="font-mono" style={{ fontSize: "12px", color: "#ccc" }}>£{amount}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "12px" }}>
          <span style={{ fontSize: "13px", color: "#fff", fontWeight: 500 }}>Total</span>
          <span className="font-mono" style={{ fontSize: "16px", color: "#fff", fontWeight: 500 }}>£{billing.monthlyTotal}/mo</span>
        </div>
      </div>

      {/* Per-client seats with upgrade */}
      {billing.clients.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "#fff", marginBottom: "12px" }}>Clients</div>
          {billing.clients.map(c => {
            const isStarter = c.clientTier === "starter";
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#ccc" }}>{c.businessName}</div>
                  <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>
                    {isStarter ? "Starter · £200/mo" : "Full service · £500/mo"}
                  </div>
                </div>
                {isStarter && (
                  <button
                    onClick={() => void upgrade(c.id)}
                    disabled={busy === c.id}
                    style={{ fontSize: "11px", color: "#C9A84C", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: "6px", padding: "5px 10px", cursor: busy === c.id ? "default" : "pointer" }}
                  >
                    {busy === c.id ? "Upgrading…" : "Upgrade → Full service"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
