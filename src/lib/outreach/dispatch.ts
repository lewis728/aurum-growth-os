/**
 * src/lib/outreach/dispatch.ts
 * SERVER-SIDE ONLY. The ONE place that pushes generated prospects into Instantly,
 * so the manual push route and the autopilot cron behave identically and BOTH:
 *   - enforce the permanent suppression list (never email an opt-out/bounce),
 *   - validate emails,
 *   - inject via Instantly,
 *   - record every sent sequence to the OutreachMessage system-of-record,
 *   - move successes to 'emailing'.
 *
 * NEVER THROWS. Returns counts the caller can surface.
 */

import { prisma } from "@/lib/prisma";
import { injectLeads, instantlyConfigured, type InstantlyLead } from "@/lib/outreach/instantlyClient";
import { filterSuppressed, suppress } from "@/lib/outreach/suppression";
import { logSequenceSent } from "@/lib/outreach/messages";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DispatchResult {
  pushed:        number;
  failed:        number;
  suppressed:    number;
  ineligible:    number;
  notConfigured: boolean;
}

/**
 * Pushes a set of 'generated' prospects (by id, or all generated for the tenant)
 * into Instantly. Suppression-checked, message-logged. Never throws.
 */
export async function dispatchProspects(opts: {
  tenantId: string;
  prospectIds?: string[];   // when omitted → all 'generated' for the tenant
  limit?: number;
}): Promise<DispatchResult> {
  const { tenantId } = opts;
  const out: DispatchResult = { pushed: 0, failed: 0, suppressed: 0, ineligible: 0, notConfigured: false };

  const rows = await prisma.outreachProspect.findMany({
    where: {
      tenantId, status: "generated", unsubscribed: false,
      contactEmail: { not: null }, customHook: { not: null },
      ...(opts.prospectIds && opts.prospectIds.length ? { id: { in: opts.prospectIds } } : {}),
    },
    take: opts.limit ?? 100,
    select: {
      id: true, firstName: true, companyName: true, cleanCompanyName: true, contactEmail: true, customHook: true, website: true,
      sequences: { orderBy: { emailNumber: "asc" }, select: { emailNumber: true, subject: true, body: true } },
    },
  }).catch(() => []);

  // Valid email + has a sequence.
  const valid = rows.filter((p) => p.contactEmail && EMAIL_RE.test(p.contactEmail) && p.sequences.length > 0);
  out.ineligible = rows.length - valid.length;
  if (valid.length === 0) return out;

  // Suppression gate — drop anyone on the do-not-contact list (and close them).
  const suppressedSet = await filterSuppressed(tenantId, valid.map((p) => p.contactEmail as string));
  const sendable = valid.filter((p) => !suppressedSet.has((p.contactEmail as string).toLowerCase()));
  out.suppressed = valid.length - sendable.length;
  await Promise.all(
    valid.filter((p) => suppressedSet.has((p.contactEmail as string).toLowerCase()))
      .map((p) => prisma.outreachProspect.update({ where: { id: p.id }, data: { status: "closed" } }).catch(() => {})),
  );
  if (sendable.length === 0) return out;

  if (!instantlyConfigured()) { out.notConfigured = true; return out; }

  const leads: InstantlyLead[] = sendable.map((p) => ({
    email:             p.contactEmail as string,
    first_name:        p.firstName ?? "there",
    custom_hook:       p.customHook ?? "",
    custom_clean_name: p.cleanCompanyName ?? p.companyName,
  }));

  const res = await injectLeads(leads);

  await Promise.all(sendable.map(async (p, i) => {
    const leadId = res.leadIds[i];
    if (!leadId) { out.failed++; return; }
    out.pushed++;
    await prisma.outreachProspect.update({
      where: { id: p.id },
      data:  { status: "emailing", instantlyLeadId: leadId, emailsSent: p.sequences.length, lastEmailAt: new Date() },
    }).catch(() => {});
    // Record the whole sequence to the system-of-record.
    await logSequenceSent({
      tenantId, prospectId: p.id, externalId: leadId,
      emails: p.sequences.map((s) => ({ emailNumber: s.emailNumber, subject: s.subject, body: s.body })),
    });
  }));

  return out;
}

/** Convenience: suppress + close a prospect (used by reply opt-out handling). */
export async function suppressProspect(tenantId: string, prospectId: string, email: string | null, reason: string, website?: string): Promise<void> {
  if (email) await suppress(tenantId, email, reason, website);
  await prisma.outreachProspect.update({ where: { id: prospectId }, data: { status: "closed", unsubscribed: true } }).catch(() => {});
}
