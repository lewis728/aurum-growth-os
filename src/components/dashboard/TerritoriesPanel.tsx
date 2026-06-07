"use client";

/**
 * Territories — the demand-arbitrage view in God Mode. Cities with contractors,
 * revenue per city (£700 lock-ins + £350 paid surveys), status, and any failed
 * charges needing attention. Reads /api/admin/territories.
 */
import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to load");
    return r.json();
  });

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";
function gbp(n: number): string {
  return `£${n.toLocaleString("en-GB")}`;
}
function statusColor(status: string): string {
  switch (status) {
    case "active": return "#22c55e";
    case "paused": return "#f59e0b";
    case "pending": return "#52525b";
    default: return "var(--text-3, #52525b)";
  }
}

interface Territory {
  city: string;
  vertical: string;
  contractors: { name: string; status: string; priority: number }[];
  revenueGbp: number;
  bookings: number;
  failedCharges: number;
  activeCount: number;
}

export function TerritoriesPanel(): React.ReactElement {
  const { data } = useSWR<{ territories: Territory[] }>("/api/admin/territories", fetcher, { refreshInterval: 60_000 });
  const territories = data?.territories ?? [];

  return (
    <section style={{ padding: "8px 24px 32px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1,#fff)" }}>Territories</h2>
        <span style={{ fontSize: 12, color: "var(--text-3,#52525b)" }}>
          {territories.length} {territories.length === 1 ? "territory" : "territories"} · {gbp(territories.reduce((s, t) => s + t.revenueGbp, 0))} total
        </span>
      </div>

      <div style={{ border: "1px solid var(--border,rgba(255,255,255,0.06))", borderRadius: 10, overflow: "hidden" }}>
        {/* header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1.6fr 0.8fr 0.8fr 1fr",
            gap: 12,
            padding: "10px 16px",
            fontSize: 12,
            color: "var(--text-3,#52525b)",
            borderBottom: "1px solid var(--border,rgba(255,255,255,0.06))",
          }}
        >
          <div>City / trade</div>
          <div>Contractors</div>
          <div style={{ textAlign: "right" }}>Bookings</div>
          <div style={{ textAlign: "right" }}>Revenue</div>
          <div style={{ textAlign: "right" }}>Failed</div>
        </div>

        {territories.length === 0 && (
          <div style={{ padding: "20px 16px", fontSize: 14, color: "var(--text-3,#52525b)" }}>
            No territories yet. Sell a city via the contractor onboarding link.
          </div>
        )}

        {territories.map((t) => (
          <div
            key={`${t.city}-${t.vertical}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1.6fr 1.6fr 0.8fr 0.8fr 1fr",
              gap: 12,
              padding: "14px 16px",
              alignItems: "center",
              borderBottom: "1px solid var(--border,rgba(255,255,255,0.06))",
            }}
          >
            <div>
              <div style={{ fontSize: 14, color: "var(--text-1,#fff)", fontWeight: 500 }}>{t.city}</div>
              <div style={{ fontSize: 12, color: "var(--text-3,#52525b)" }}>
                {t.vertical === "home_improvement" ? "home improvement" : "roofing"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t.contractors.map((c, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2,#a1a1aa)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor(c.status) }} />
                  {c.name}
                  {i === 0 ? "" : <span style={{ color: "var(--text-3,#52525b)" }}> (backup)</span>}
                </span>
              ))}
            </div>
            <div style={{ textAlign: "right", fontFamily: mono, fontSize: 15, color: "var(--text-1,#fff)" }}>{t.bookings}</div>
            <div style={{ textAlign: "right", fontFamily: mono, fontSize: 15, color: "var(--text-1,#fff)" }}>{gbp(t.revenueGbp)}</div>
            <div style={{ textAlign: "right", fontFamily: mono, fontSize: 15, color: t.failedCharges > 0 ? "#ef4444" : "var(--text-3,#52525b)" }}>
              {t.failedCharges > 0 ? t.failedCharges : "—"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
