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
import { isRoleEmail, extractCity } from "@/lib/outreach/decisionMaker";
import { verifierConfigured } from "@/lib/outreach/verify";
import { nicheConfig, bookingTerm, revenueTerm } from "@/lib/outreach/niche";
import { detectRegion } from "@/lib/outreach/regional";

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
      vertical: true, location: true, country: true, verificationStatus: true,
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

  // ── Final owner-only + brutal-verify gate (defense in depth) ────────────────
  // Never send to a generic/role inbox, and (when a verifier is configured) never
  // send anything that isn't a confirmed-valid mailbox. Uses the STORED
  // verificationStatus from generate-time — no extra verifier spend here.
  const verifyOn = verifierConfigured();
  const eligible = sendable.filter((p) => {
    if (isRoleEmail(p.contactEmail)) return false;
    if (verifyOn && p.verificationStatus !== "valid") return false;
    return true;
  });
  const blocked = sendable.filter((p) => !eligible.includes(p));
  out.ineligible += blocked.length;
  await Promise.all(blocked.map((p) =>
    prisma.outreachProspect.update({
      where: { id: p.id },
      data: { status: isRoleEmail(p.contactEmail) ? "rejected" : "review" },
    }).catch(() => {}),
  ));
  if (eligible.length === 0) return out;

  if (!instantlyConfigured()) { out.notConfigured = true; return out; }

  const yourName = process.env.OUTREACH_OWNER_NAME?.trim() || "Lewis";
  const leads: InstantlyLead[] = eligible.map((p) => {
    const region = detectRegion(p.country);
    const niche = nicheConfig(p.vertical);
    const byNum = (n: number) => p.sequences.find((s) => s.emailNumber === n);
    const seq1 = byNum(1) ?? p.sequences[0]; // email 1 — fully rendered
    const company = p.cleanCompanyName ?? p.companyName;
    return {
      email:             p.contactEmail as string,
      first_name:        p.firstName ?? "there",
      custom_hook:       p.customHook ?? "",
      custom_clean_name: company,
      company_name:      company,
      subject_line:      seq1?.subject ?? "",
      email_body:        seq1?.body ?? "",
      // Whole sequence app-controlled — Instantly follow-up steps use these.
      subject_2:         byNum(2)?.subject,
      email_body_2:      byNum(2)?.body,
      subject_3:         byNum(3)?.subject,
      email_body_3:      byNum(3)?.body,
      subject_4:         byNum(4)?.subject,
      email_body_4:      byNum(4)?.body,
      city:              extractCity(p.location) || (p.location ?? ""),
      niche_service:     niche.service,
      regional_booking_term: bookingTerm(p.vertical, region),
      regional_revenue_term: revenueTerm(region),
      your_name:         yourName,
    };
  });

  const res = await injectLeads(leads);

  await Promise.all(eligible.map(async (p, i) => {
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
