/**
 * src/lib/intelligence/capacityMonitor.ts
 * SERVER-SIDE ONLY. Layer 7 (Part 8) — operational capacity autothrottle.
 *
 * Marcus matches ad spend to the client's REAL calendar capacity, because over-
 * delivery (more bookings than they can serve) is the #1 reason agencies lose
 * clients. Three jobs, all NEVER THROW:
 *   1. throttle — read calendar utilisation (next 14 days) → scale Meta budget.
 *   2. flash campaign — on 2+ cancellations in 2h, SMS warm leads the freed slot.
 *   3. day-25 retainer report — performance summary → Slack + ReportCard.
 *
 * Calendar reads use the Google freebusy API with the tenant's stored token
 * (reusing the encryption seam). If no calendar is connected we fall back to
 * DB appointment counts so the throttle still has a signal.
 */

import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/services/metaAuthService";
import { updateCampaignBudget } from "@/lib/services/metaAdsService";
import { sendDirectSMS, safeWhatsApp } from "@/lib/services/twilioService";
import { sendAgencyAlert } from "@/lib/services/alertService";
import { resolveTemplate, renderTemplate, parseSmsTemplates } from "@/lib/services/smsTemplates";

const GOOGLE_CAL_BASE = "https://www.googleapis.com/calendar/v3";
const USD_TO_GBP = 1 / 1.27;
const WORKDAY_SLOTS = 8;   // assumed bookable consults per working day
const HORIZON_DAYS = 14;

export interface CapacityReading {
  availableSlots: number;
  bookedSlots: number;
  utilisationPct: number;  // 0-1
  source: "calendar" | "appointments";
}

/** Reads next-14-day utilisation. Prefers Google freebusy; falls back to DB. NEVER THROWS. */
export async function readCapacity(blueprintId: string, tenantId: string): Promise<CapacityReading> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
  // Working-day capacity over the horizon (~10 weekdays in 14 calendar days).
  const workingDays = Math.round((HORIZON_DAYS / 7) * 5);
  const totalSlots = workingDays * WORKDAY_SLOTS;

  // Try Google freebusy.
  try {
    const conn = await prisma.calendarConnection.findUnique({
      where: { tenantId },
      select: { provider: true, encryptedToken: true, calendarId: true, expiresAt: true },
    });
    if (conn && conn.provider === "GOOGLE" && (!conn.expiresAt || conn.expiresAt > now)) {
      const token = decryptToken(conn.encryptedToken);
      const res = await fetch(`${GOOGLE_CAL_BASE}/freeBusy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ timeMin: now.toISOString(), timeMax: horizon.toISOString(), items: [{ id: conn.calendarId }] }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
        const busy = data.calendars?.[conn.calendarId]?.busy ?? [];
        const bookedSlots = busy.length;
        const utilisationPct = totalSlots > 0 ? Math.min(1, bookedSlots / totalSlots) : 0;
        return { availableSlots: Math.max(0, totalSlots - bookedSlots), bookedSlots, utilisationPct, source: "calendar" };
      }
    }
  } catch (err) {
    console.error("[capacityMonitor] freebusy read failed:", err instanceof Error ? err.message : err);
  }

  // Fallback: count confirmed future appointments in the DB.
  const bookedSlots = await prisma.appointment.count({
    where: { blueprintId, tenantId, status: "confirmed", scheduledAt: { gte: now, lte: horizon } },
  }).catch(() => 0);
  const utilisationPct = totalSlots > 0 ? Math.min(1, bookedSlots / totalSlots) : 0;
  return { availableSlots: Math.max(0, totalSlots - bookedSlots), bookedSlots, utilisationPct, source: "appointments" };
}

/** Decides the throttle action from utilisation. Pure. */
export function throttleDecision(utilisationPct: number): { factor: number; label: string } | null {
  if (utilisationPct > 0.90) return { factor: 0.60, label: "Throttling spend — client at 90%+ capacity" };
  if (utilisationPct > 0.75) return { factor: 0.80, label: "Reducing spend — client at 75%+ capacity" };
  if (utilisationPct < 0.40) return { factor: 1.20, label: "Scaling spend — client has available capacity" };
  return null; // 40-75% → maintain
}

export interface CapacityResult { blueprintId: string; utilisationPct: number; action: string; }

/** Runs the capacity throttle for ONE live blueprint. NEVER THROWS. */
export async function runCapacityCheck(blueprintId: string, tenantId: string): Promise<CapacityResult> {
  try {
    const bp = await prisma.campaignBlueprint.findFirst({
      where: { id: blueprintId, tenantId, status: "live" },
      select: { dailyBudgetUsd: true, mediaBuying: true, businessName: true, clientBrief: { select: { budgetHardLimit: true } } },
    });
    if (!bp) return { blueprintId, utilisationPct: 0, action: "skipped" };

    const reading = await readCapacity(blueprintId, tenantId);
    const decision = throttleDecision(reading.utilisationPct);
    let action = "maintain";

    if (decision) {
      const adSetId = ((bp.mediaBuying as Record<string, unknown> | null)?.metaAdIds as Record<string, unknown> | undefined)?.adSetId;
      const currentGbp = bp.dailyBudgetUsd * USD_TO_GBP;
      let proposedGbp = currentGbp * decision.factor;
      // Respect the hard limit on scale-ups.
      const hardLimit = bp.clientBrief?.budgetHardLimit;
      if (decision.factor > 1 && hardLimit != null) proposedGbp = Math.min(proposedGbp, hardLimit);

      if (typeof adSetId === "string" && Math.abs(proposedGbp - currentGbp) > 0.5) {
        const proposedUsd = proposedGbp / USD_TO_GBP;
        await updateCampaignBudget(adSetId, Math.round(proposedUsd * 100), tenantId).catch((e) =>
          console.error("[capacityMonitor] budget update failed:", e instanceof Error ? e.message : e));
        action = `${decision.label} (£${currentGbp.toFixed(0)}→£${proposedGbp.toFixed(0)}/day)`;
      } else {
        action = `${decision.label} (advisory — no ad set or change too small)`;
      }
      await prisma.agentAction.create({ data: {
        tenantId, blueprintId, agentName: "Marcus", actionType: "CAPACITY_THROTTLE",
        reasoning: `Calendar ${Math.round(reading.utilisationPct * 100)}% utilised (${reading.bookedSlots}/${reading.bookedSlots + reading.availableSlots} slots, ${reading.source}).`,
        outcome: action,
      } }).catch(() => {});
    }

    await prisma.capacitySnapshot.create({ data: {
      blueprintId, tenantId, utilisationPct: reading.utilisationPct,
      availableSlots: reading.availableSlots, bookedSlots: reading.bookedSlots, action: decision ? action : null,
    } }).catch(() => {});

    return { blueprintId, utilisationPct: reading.utilisationPct, action };
  } catch (err) {
    console.error(`[capacityMonitor] check failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { blueprintId, utilisationPct: 0, action: "error" };
  }
}

/**
 * Flash campaign: if 2+ confirmed appts were cancelled in the last 2h, SMS the
 * client's warm (qualified, unbooked) leads about the freed slot. NEVER THROWS.
 */
export async function runFlashCampaign(blueprintId: string, tenantId: string): Promise<{ contacted: number }> {
  try {
    const twoHrsAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const cancellations = await prisma.appointment.count({
      where: { blueprintId, tenantId, status: "cancelled", updatedAt: { gte: twoHrsAgo } },
    });
    if (cancellations < 2) return { contacted: 0 };

    const [bp, warm] = await Promise.all([
      prisma.campaignBlueprint.findUnique({ where: { id: blueprintId }, select: { businessName: true, vertical: true, clientBrief: { select: { smsTemplates: true } } } }),
      prisma.lead.findMany({
        where: { blueprintId, tenantId, status: "qualified" },
        select: { id: true, firstName: true, phone: true }, take: 25,
      }),
    ]);
    if (!bp || warm.length === 0) return { contacted: 0 };

    const businessName = bp.businessName ?? "us";
    const tplBody = resolveTemplate("qualifiedNudge", parseSmsTemplates(bp.clientBrief?.smsTemplates), bp.vertical);
    let contacted = 0;
    for (const lead of warm) {
      const msg = renderTemplate(tplBody, { lead_first_name: lead.firstName, business_name: businessName })
        + ` We've just had a cancellation — want to grab the slot? It's going fast.`;
      try { await sendDirectSMS(lead.phone, msg); contacted++; }
      catch (e) { console.error("[capacityMonitor] flash SMS failed:", e instanceof Error ? e.message : e); }
    }
    await prisma.agentAction.create({ data: {
      tenantId, blueprintId, agentName: "Marcus", actionType: "FLASH_CAMPAIGN",
      reasoning: `${cancellations} cancellations in 2h — contacting warm leads to refill.`,
      outcome: `Flash campaign launched — ${contacted} warm leads contacted`,
    } }).catch(() => {});
    return { contacted };
  } catch (err) {
    console.error(`[capacityMonitor] flash campaign failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { contacted: 0 };
  }
}

/**
 * Day-25 retainer-transition report. Generates once per client (unique kind),
 * stores a ReportCard, and Slacks the agency owner. NEVER THROWS.
 */
export async function maybeRunDay25Report(blueprintId: string, tenantId: string): Promise<boolean> {
  try {
    const bp = await prisma.campaignBlueprint.findFirst({
      where: { id: blueprintId, tenantId, status: "live" },
      select: { businessName: true, createdAt: true, clientBrief: { select: { averageClientValue: true } } },
    });
    if (!bp) return false;
    const ageDays = (Date.now() - bp.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < 25 || ageDays >= 26) return false; // only on day 25

    const existing = await prisma.reportCard.findUnique({ where: { blueprintId_kind: { blueprintId, kind: "retainer_day25" } } });
    if (existing) return false; // already generated

    const since = bp.createdAt;
    const [totalLeads, totalBooked, cap] = await Promise.all([
      prisma.lead.count({ where: { blueprintId, tenantId, createdAt: { gte: since } } }),
      prisma.appointment.count({ where: { blueprintId, tenantId, createdAt: { gte: since } } }),
      readCapacity(blueprintId, tenantId),
    ]);
    const avgValue = bp.clientBrief?.averageClientValue ?? 0;
    const estRevenue = totalBooked * avgValue;
    const retainerCost = 2000;
    const roi = retainerCost > 0 ? estRevenue / retainerCost : 0;
    const summary = `Day-25 report for ${bp.businessName}: ${totalLeads} leads, ${totalBooked} booked, ` +
      `est £${estRevenue.toFixed(0)} revenue, ${Math.round(cap.utilisationPct * 100)}% capacity, ${roi.toFixed(1)}x ROI on the £${retainerCost} retainer.`;

    await prisma.reportCard.create({ data: {
      blueprintId, tenantId, kind: "retainer_day25",
      totalLeads, totalBooked, estRevenueGbp: estRevenue, utilisationPct: cap.utilisationPct, roi, summary,
    } }).catch(() => {});

    await sendAgencyAlert(tenantId, {
      actionType: "NEEDS_APPROVAL", clientName: bp.businessName, agentName: "Marcus",
      issue: summary, recommended: `Transition ${bp.businessName} to the paid retainer — ${roi.toFixed(1)}x ROI on the trial.`,
      blueprintId,
    }).catch(() => {});
    return true;
  } catch (err) {
    console.error(`[capacityMonitor] day25 report failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
