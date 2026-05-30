/**
 * src/hooks/useAgentFeed.ts
 * Live stream of AgentAction rows for the current tenant.
 *
 * 1. Loads the last 20 actions via /api/agent/actions (also yields tenantId).
 * 2. Opens a Supabase Realtime subscription on AgentAction INSERT, filtered to
 *    this tenant, and prepends new rows as they arrive — no polling.
 *
 * Degrades gracefully: if Supabase public env is absent the initial snapshot
 * still renders, just without live updates (isLive=false).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

export interface AgentActionItem {
  id:          string;
  agentName:   string;
  actionType:  string;
  reasoning:   string;
  outcome:     string;
  executedAt:  string;
  blueprintId: string | null;
}

interface ActionsResponse {
  tenantId: string;
  actions:  AgentActionItem[];
}

const MAX_ITEMS = 20;

export function useAgentFeed(): { actions: AgentActionItem[]; isLive: boolean; isLoading: boolean } {
  const [actions,   setActions]   = useState<AgentActionItem[]>([]);
  const [isLive,    setIsLive]    = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let tenantId: string | null = null;
      try {
        const res = await fetch("/api/agent/actions");
        if (res.ok) {
          const data = (await res.json()) as ActionsResponse;
          if (!cancelled) {
            setActions((data.actions ?? []).slice(0, MAX_ITEMS));
            tenantId = data.tenantId ?? null;
          }
        }
      } catch {
        /* non-fatal — render empty */
      } finally {
        if (!cancelled) setIsLoading(false);
      }

      if (cancelled || !tenantId) return;

      const supabase = getSupabaseBrowser();
      if (!supabase) return;

      const channel = supabase
        .channel(`agent-actions:${tenantId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "AgentAction", filter: `tenantId=eq.${tenantId}` },
          (payload) => {
            const row = payload.new as AgentActionItem;
            setActions(prev =>
              prev.some(a => a.id === row.id) ? prev : [row, ...prev].slice(0, MAX_ITEMS)
            );
          }
        )
        .subscribe(status => {
          if (!cancelled) setIsLive(status === "SUBSCRIBED");
        });

      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, []);

  return { actions, isLive, isLoading };
}
