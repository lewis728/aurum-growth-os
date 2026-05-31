"use client";

/**
 * PipelineBoard — the per-client CRM pipeline (Sprint 3B).
 * Replaces the flat leads table with a stage board. Leads move automatically:
 * the server DERIVES each lead's stage from its status + appointment outcome
 * (see src/lib/crm/pipeline.ts) — there is no manual drag/move. The only manual
 * action is marking a lead "converted" (a won deal) with an optional deal value.
 *
 * Click a lead card to expand: call summary/transcript (from callAnalysis),
 * appointment details, and the convert control.
 *
 * Design: premium dark glass per CLAUDE.md — var(--surface-*), var(--border),
 * coloured score dots, JetBrains Mono for numbers.
 */

import { useState } from "react";
import {
  PIPELINE_BOARD_COLUMNS,
  PIPELINE_LABELS,
  type PipelineCell,
} from "@/lib/crm/pipeline";

interface AppointmentLite {
  status:      string;
  scheduledAt: string;
  notes:       string | null;
}
interface CallAnalysis {
  transcript?: string;
  summary?:    string;
  call_analysis?: { call_summary?: string };
  custom_analysis_data?: { summary?: string };
}
export interface PipelineLead {
  id:            string;
  firstName:     string;
  lastName:      string;
  phone:         string;
  email:         string | null;
  status:        string;
  pipelineStage: string;
  leadScore:     number | null;
  callAttempts:  number;
  dealValue:     number | null;
  source:        string;
  createdAt:     string;
  updatedAt:     string;
  callAnalysis:  CallAnalysis | null;
  appointment:   AppointmentLite | null;
}

const mono = "var(--font-mono, 'JetBrains Mono', monospace)";

function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-3, #52525b)";
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function summaryOf(ca: CallAnalysis | null): string | null {
  if (!ca) return null;
  return (
    ca.call_analysis?.call_summary ??
    ca.custom_analysis_data?.summary ??
    ca.summary ??
    null
  );
}

export function PipelineBoard({
  leads,
  onChanged,
}: {
  leads: PipelineLead[];
  onChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);

  // Group leads by their (derived) stage; only render columns that have leads,
  // so an empty board doesn't show 10 empty columns.
  const byStage = new Map<PipelineCell, PipelineLead[]>();
  for (const l of leads) {
    const cell = (l.pipelineStage as PipelineCell);
    const arr = byStage.get(cell) ?? [];
    arr.push(l);
    byStage.set(cell, arr);
  }
  const columns = PIPELINE_BOARD_COLUMNS.filter((c) => (byStage.get(c)?.length ?? 0) > 0);

  async function convert(leadId: string) {
    setConverting(leadId);
    try {
      const raw = window.prompt("Deal value (£)? Leave blank to mark converted without a value.");
      if (raw === null) { setConverting(null); return; } // cancelled
      const trimmed = raw.trim();
      const dealValue = trimmed ? Number(trimmed) : undefined;
      if (trimmed && (isNaN(dealValue as number) || (dealValue as number) < 0)) {
        alert("Enter a valid non-negative number, or leave blank.");
        setConverting(null);
        return;
      }
      const res = await fetch(`/api/leads/${leadId}/convert`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(dealValue !== undefined ? { dealValue } : {}),
      });
      if (res.ok) onChanged?.();
      else alert("Could not mark converted.");
    } finally {
      setConverting(null);
    }
  }

  if (leads.length === 0) {
    return (
      <div
        className="rounded-xl flex items-center justify-center py-10"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-3)" }}>No leads yet</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "8px" }}>
      {columns.map((cell) => {
        const colLeads = byStage.get(cell) ?? [];
        return (
          <div key={cell} style={{ minWidth: "240px", flex: "0 0 240px" }}>
            <div
              className="px-3 py-2 flex items-center justify-between rounded-t-lg"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              <span className="text-[11px] uppercase tracking-widest font-medium" style={{ color: "var(--text-2)" }}>
                {PIPELINE_LABELS[cell]}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-3)", fontFamily: mono }}>
                {colLeads.length}
              </span>
            </div>

            <div
              className="flex flex-col gap-2 p-2 rounded-b-lg"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderTop: "none", minHeight: "60px" }}
            >
              {colLeads.map((l) => {
                const isOpen = expanded === l.id;
                const summary = summaryOf(l.callAnalysis);
                return (
                  <div
                    key={l.id}
                    className="rounded-lg cursor-pointer"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                    onClick={() => setExpanded(isOpen ? null : l.id)}
                  >
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: scoreColor(l.leadScore) }} />
                        <span className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                          {l.firstName} {l.lastName}
                        </span>
                        <span className="ml-auto text-[10px]" style={{ color: "var(--text-3)", fontFamily: mono }}>
                          {timeAgo(l.updatedAt)}
                        </span>
                      </div>
                      <div className="text-[11px] mt-1 font-mono truncate" style={{ color: "var(--text-3)" }}>
                        {l.phone}
                      </div>
                      {l.dealValue != null && (
                        <div className="text-[11px] mt-1" style={{ color: "#22c55e", fontFamily: mono }}>
                          £{l.dealValue.toLocaleString("en-GB")}
                        </div>
                      )}
                    </div>

                    {isOpen && (
                      <div className="px-3 pb-3 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
                        {l.appointment && (
                          <div className="text-[11px] mb-2" style={{ color: "var(--text-2)" }}>
                            <span style={{ color: "var(--text-3)" }}>Appointment: </span>
                            {new Date(l.appointment.scheduledAt).toLocaleString("en-GB", {
                              weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                            })} · {l.appointment.status}
                          </div>
                        )}
                        {summary && (
                          <div className="text-[11px] mb-2" style={{ color: "var(--text-2)", lineHeight: 1.5 }}>
                            <span style={{ color: "var(--text-3)" }}>Call: </span>{summary}
                          </div>
                        )}
                        <div className="text-[10px] mb-2" style={{ color: "var(--text-3)" }}>
                          {l.callAttempts} call{l.callAttempts === 1 ? "" : "s"} · source: {l.source}
                        </div>
                        {l.pipelineStage !== "converted" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); void convert(l.id); }}
                            disabled={converting === l.id}
                            className="text-[11px] px-2 py-1 rounded-md font-medium disabled:opacity-40"
                            style={{ background: "var(--gold, #C9A84C)", color: "#000" }}
                          >
                            {converting === l.id ? "Saving…" : "Mark converted"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
