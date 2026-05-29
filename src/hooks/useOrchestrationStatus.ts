"use client";
/**
 * src/hooks/useOrchestrationStatus.ts
 * CLIENT-SIDE ONLY. Never import server-only modules here.
 *
 * SSE hook connecting to GET /api/orchestrator/status/[blueprintId].
 * Opens EventSource when blueprintId is provided.
 * Closes and cleans up on unmount — no memory leaks.
 */

import { useState, useEffect, useRef } from "react";
import type { OrchestratorEvent } from "@/types/campaignBlueprint";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseOrchestrationStatusResult {
  /** Accumulated list of orchestration events received via SSE. */
  orchestrationLog: OrchestratorEvent[];
  /** True when a LIVE or ORCHESTRATION_COMPLETE event has been received. */
  isComplete: boolean;
  /** True when a FAILED event has been received. */
  isError: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Connects to the orchestrator status SSE endpoint for the given blueprintId.
 * Passing null or undefined closes any existing connection.
 */
export function useOrchestrationStatus(
  blueprintId: string | null | undefined
): UseOrchestrationStatusResult {
  const [orchestrationLog, setOrchestrationLog] = useState<OrchestratorEvent[]>([]);
  const [isComplete, setIsComplete]             = useState(false);
  const [isError, setIsError]                   = useState(false);

  // Keep a stable ref to the EventSource so the cleanup function always
  // closes the most recent connection even if blueprintId changes quickly.
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Reset state when blueprintId changes
    setOrchestrationLog([]);
    setIsComplete(false);
    setIsError(false);

    // Close any existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // Do nothing if no blueprintId
    if (!blueprintId) return;

    const url = `/api/orchestrator/status/${encodeURIComponent(blueprintId)}`;
    const es  = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed: unknown = JSON.parse(event.data);

        // Heartbeat pings — ignore
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "type" in parsed &&
          (parsed as Record<string, unknown>).type === "heartbeat"
        ) {
          return;
        }

        // OrchestratorEvent
        const oe = parsed as OrchestratorEvent;
        setOrchestrationLog((prev) => [...prev, oe]);

        // Terminal states
        if (oe.step === "ORCHESTRATION_COMPLETE" || oe.status === "success") {
          if (oe.step === "ORCHESTRATION_COMPLETE") {
            setIsComplete(true);
            es.close();
            esRef.current = null;
          }
        }

        if (oe.status === "failure") {
          setIsError(true);
          setIsComplete(true); // treat failure as terminal
          es.close();
          esRef.current = null;
        }
      } catch {
        // Non-JSON message — ignore silently
      }
    };

    es.onerror = () => {
      // Connection dropped — mark as error and close
      setIsError(true);
      es.close();
      esRef.current = null;
    };

    // Cleanup on unmount or blueprintId change
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [blueprintId]);

  return { orchestrationLog, isComplete, isError };
}
