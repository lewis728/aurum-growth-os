"use client";

/**
 * CompetitorPanel — competitor intelligence (Sprint 15).
 * Renders the latest weekly competitor snapshot stored on
 * ClientBrief.competitorIntel: what rivals are running, what's working for them,
 * and the gaps this client can exploit. Read-only; refreshed weekly by the
 * /api/cron/competitor-intel scan (Friday 05:00).
 *
 * Source: GET /api/clients/[blueprintId]/brief → brief.competitorIntel[0].
 * Premium dark glass to match the rest of the sub-account.
 */

import { useState, useEffect, useCallback } from "react";

interface Snapshot {
  weekOf:          string;
  competitorCount: number;
  adCount:         number;
  summary:         string;
  whatsWorking:    string[];
  gaps:            string[];
  sampleAds:       string[];
  usedAdLibrary:   boolean;
}

const cardStyle = { background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px" } as const;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function CompetitorPanel({ blueprintId }: { blueprintId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [weeks, setWeeks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAds, setShowAds] = useState(false);

  const load = useCallback(() => {
    void fetch(`/api/clients/${blueprintId}/brief`)
      .then((r) => (r.ok ? r.json() : { brief: null }))
      .then((d: { brief: { competitorIntel?: Snapshot[] | null } | null }) => {
        const arr = Array.isArray(d.brief?.competitorIntel) ? (d.brief?.competitorIntel as Snapshot[]) : [];
        setWeeks(arr.length);
        setSnap(arr[0] ?? null);
      })
      .catch(() => { /* leave empty */ })
      .finally(() => setLoading(false));
  }, [blueprintId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={cardStyle}><span style={{ fontSize: "12px", color: "var(--text-3)" }}>Loading competitor intel…</span></div>;
  }

  return (
    <div style={cardStyle}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Competitor intelligence</div>
        {snap && (
          <span className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>
            week of {fmtDate(snap.weekOf)}
          </span>
        )}
      </div>

      {!snap ? (
        <div className="text-[11px]" style={{ color: "var(--text-3)" }}>
          No competitor scan yet. The weekly scan runs every Friday and will appear here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Stat row */}
          <div className="flex items-center gap-5">
            <div>
              <div className="text-lg font-mono" style={{ color: "var(--text-1)" }}>{snap.competitorCount}</div>
              <div className="text-[10px]" style={{ color: "var(--text-3)" }}>advertisers</div>
            </div>
            <div>
              <div className="text-lg font-mono" style={{ color: "var(--text-1)" }}>{snap.adCount}</div>
              <div className="text-[10px]" style={{ color: "var(--text-3)" }}>live ads</div>
            </div>
            <div>
              <div className="text-lg font-mono" style={{ color: "var(--text-1)" }}>{weeks}</div>
              <div className="text-[10px]" style={{ color: "var(--text-3)" }}>weeks tracked</div>
            </div>
          </div>

          {!snap.usedAdLibrary && (
            <div className="text-[10px] rounded-md p-2" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
              No live ads were retrievable this week — this read is advisory, from vertical expertise rather than a live sample.
            </div>
          )}

          {snap.summary && (
            <div className="text-[12px]" style={{ color: "var(--text-2)", lineHeight: 1.55 }}>{snap.summary}</div>
          )}

          {snap.whatsWorking.length > 0 && (
            <div>
              <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-1)" }}>What&apos;s working for them</div>
              <ul style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {snap.whatsWorking.map((w, i) => (
                  <li key={i} className="text-[12px] flex gap-2" style={{ color: "var(--text-2)" }}>
                    <span style={{ color: "var(--gold)" }}>•</span><span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {snap.gaps.length > 0 && (
            <div>
              <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-1)" }}>Gaps we can exploit</div>
              <ul style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {snap.gaps.map((g, i) => (
                  <li key={i} className="text-[12px] flex gap-2" style={{ color: "var(--text-2)" }}>
                    <span style={{ color: "#22c55e" }}>↗</span><span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {snap.sampleAds.length > 0 && (
            <div>
              <button
                onClick={() => setShowAds((v) => !v)}
                className="text-[10px]"
                style={{ color: "var(--gold)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                {showAds ? "Hide sample ads" : `Show ${snap.sampleAds.length} sample ads`}
              </button>
              {showAds && (
                <ul className="mt-2" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {snap.sampleAds.map((a, i) => (
                    <li key={i} className="text-[11px] rounded-md p-2" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
