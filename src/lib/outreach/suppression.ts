/**
 * src/lib/outreach/suppression.ts
 * SERVER-SIDE ONLY. The permanent do-not-contact list. Checked before EVERY send
 * (manual, batch, autopilot, re-engagement) so an opt-out / bounce / complaint is
 * honoured forever, across all campaigns. Protects the sending domain + keeps the
 * operation legal. NEVER THROWS.
 */

import { prisma } from "@/lib/prisma";
import { domainOf } from "@/lib/outreach/websiteText";

/** Adds an email (and its domain) to the suppression list. Idempotent. */
export async function suppress(tenantId: string, email: string, reason: string, website?: string): Promise<void> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return;
  const domain = website ? domainOf(website) : (clean.split("@")[1] ?? null);
  try {
    await prisma.outreachSuppression.upsert({
      where:  { tenantId_email: { tenantId, email: clean } },
      create: { tenantId, email: clean, domain, reason: reason.slice(0, 200) },
      update: { reason: reason.slice(0, 200) },
    });
  } catch (err) {
    console.error("[suppression] add failed:", err instanceof Error ? err.message : err);
  }
}

/** True if this email (or its domain) is suppressed for the tenant. Never throws. */
export async function isSuppressed(tenantId: string, email: string | null | undefined): Promise<boolean> {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return false;
  const domain = clean.split("@")[1] ?? null;
  try {
    const hit = await prisma.outreachSuppression.findFirst({
      where: { tenantId, OR: [{ email: clean }, ...(domain ? [{ domain }] : [])] },
      select: { id: true },
    });
    return hit !== null;
  } catch {
    return false; // fail-open on read errors is acceptable; suppression is also enforced at write time
  }
}

/** Filters a list of emails down to the ones NOT suppressed (one query). */
export async function filterSuppressed(tenantId: string, emails: string[]): Promise<Set<string>> {
  const clean = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return new Set();
  try {
    const rows = await prisma.outreachSuppression.findMany({
      where: { tenantId, email: { in: clean } },
      select: { email: true },
    });
    return new Set(rows.map((r) => r.email));
  } catch {
    return new Set();
  }
}
