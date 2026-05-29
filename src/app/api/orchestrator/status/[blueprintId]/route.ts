/**
 * src/app/api/orchestrator/status/[blueprintId]/route.ts
 * GET /api/orchestrator/status/:blueprintId
 * SERVER-SIDE ONLY.
 *
 * SSE route. Polls DB for orchestrationLog every 1500ms.
 * Emits new log entries as they appear.
 * 20-second heartbeat. Stops when status is LIVE or FAILED.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuth, getServerTenantId } from "@/lib/serverAuth";
import { prisma } from "@/lib/prisma";
import { CampaignStatus } from "@/enums/campaignEnums";
import type { OrchestratorEvent } from "@/types/campaignBlueprint";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set<string>([
  CampaignStatus.LIVE,

  CampaignStatus.FAILED,
]);

const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_MS     = 20_000;

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { blueprintId: string } }
): Promise<Response> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────────
  let tenantId: string;
  try {
    tenantId = await getServerTenantId(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { blueprintId } = params;

  if (!blueprintId) {
    return NextResponse.json({ error: "blueprintId is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(data)));
        } catch { /* controller closed */ }
      };

      const heartbeatInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, HEARTBEAT_MS);

      let pollInterval: ReturnType<typeof setInterval> | undefined; // eslint-disable-line prefer-const

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeatInterval);
        clearInterval(pollInterval);
        try { controller.close(); } catch { /* already closed */ }
      });

      let lastLogLength = 0;

      const poll = async () => {
        if (req.signal.aborted) return;

        try {
          const blueprint = await prisma.campaignBlueprint.findFirst({
            where:  { id: blueprintId, tenantId },
            select: { status: true, orchestrationLog: true },
          });

          if (!blueprint) {
            enqueue({ type: "error", error: `Blueprint ${blueprintId} not found.` });
            clearInterval(pollInterval);
            clearInterval(heartbeatInterval);
            try { controller.close(); } catch { /* closed */ }
            return;
          }

          // Emit new log entries since last poll
          const log = (blueprint.orchestrationLog as OrchestratorEvent[] | null) ?? [];
          if (log.length > lastLogLength) {
            const newEntries = log.slice(lastLogLength);
            for (const entry of newEntries) {
              enqueue({ type: "log", entry });
            }
            lastLogLength = log.length;
          }

          // Emit status update
          enqueue({ type: "status", status: blueprint.status });

          // Stop polling on terminal status
          if (TERMINAL_STATUSES.has(blueprint.status)) {
            enqueue({ type: "done", status: blueprint.status });
            clearInterval(pollInterval);
            clearInterval(heartbeatInterval);
            try { controller.close(); } catch { /* closed */ }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          enqueue({ type: "error", error: msg });
        }
      };

      // Initial poll immediately
      await poll();

      pollInterval = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "X-Accel-Buffering": "no",
      "Connection":        "keep-alive",
    },
  });
}
