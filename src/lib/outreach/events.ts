/**
 * src/lib/outreach/events.ts
 * SERVER-SIDE ONLY. Append-only activity log for the autonomous outreach agent —
 * powers the WhatsApp digest, the A/B stats, and a "what did the agent do" trail.
 * NEVER THROWS (logging must never break the pipeline).
 */

import { prisma } from "@/lib/prisma";

export type OutreachEventType =
  | "reply_received" | "reply_sent" | "calendly_sent" | "booked"
  | "unsubscribed" | "flagged" | "autopilot_run" | "pushed";

export async function logOutreachEvent(
  tenantId: string,
  type: OutreachEventType,
  detail?: string,
  prospectId?: string,
): Promise<void> {
  try {
    await prisma.outreachEvent.create({
      data: { tenantId, type, detail: detail?.slice(0, 2000) ?? null, prospectId: prospectId ?? null },
    });
  } catch (err) {
    console.error("[outreach/events] log failed:", err instanceof Error ? err.message : err);
  }
}
