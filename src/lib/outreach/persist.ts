/**
 * src/lib/outreach/persist.ts
 * SERVER-SIDE ONLY. Shared persistence for the outreach pipeline so the manual
 * "generate" route, the bulk batch generator, and the Clay webhook all run the
 * EXACT same path: qualify → (if accepted) hook + 5-email sequence → persist.
 *
 * One source of truth keeps the qualify gate and the sequence build identical
 * across every entry point. NEVER THROWS at the top level.
 */

import { prisma } from "@/lib/prisma";
import { fetchWebsiteText, domainOf } from "@/lib/outreach/websiteText";
import { sanitizeCompanyName } from "@/lib/outreach/nameSanitizer";
import { qualifyProspect } from "@/lib/outreach/qualifier";
import { buildSequence } from "@/lib/outreach/sequenceBuilder";

/** After this many failed qualify attempts a prospect is parked as "errored". */
export const MAX_ATTEMPTS = 3;

export interface ProcessInput {
  prospectId:   string;   // an existing OutreachProspect row to enrich in place
  tenantId:     string;
  variantIndex?: number;  // A/B rotation for email-1 subject
  callLink?:    string;
}

export interface ProcessResult {
  prospectId: string;
  status:     string;     // rejected | generated | error
  qualified:  boolean;
  fitScore:   number;
  customHook?: string;
  reason?:    string;
}

/**
 * Runs the full pipeline for ONE existing prospect row and writes results back.
 * Idempotent-ish: regenerates the sequence (deletes old rows first). Never throws.
 */
export async function processProspect(input: ProcessInput): Promise<ProcessResult> {
  const { prospectId, tenantId } = input;
  try {
    const p = await prisma.outreachProspect.findFirst({ where: { id: prospectId, tenantId } });
    if (!p) return { prospectId, status: "error", qualified: false, fitScore: 0, reason: "not found" };

    // Count the attempt up-front so a permanent failure (e.g. missing OpenAI key)
    // can't loop forever: after MAX_ATTEMPTS a qualifier error becomes terminal
    // ("errored") instead of bouncing back to "pending" and being re-picked.
    const attempts = p.attempts + 1;
    await prisma.outreachProspect.update({ where: { id: prospectId }, data: { status: "qualifying", attempts } });

    const websiteText = p.website ? await fetchWebsiteText(p.website) : "";
    const cleanName = p.cleanCompanyName || sanitizeCompanyName(p.companyName) || p.companyName;

    // ── Stage gate ────────────────────────────────────────────────────────────
    const q = await qualifyProspect({
      companyName: cleanName,
      location:    p.location ?? undefined,
      vertical:    p.vertical,
      websiteText,
    });

    if (!q.accepted) {
      // errored → retryable until the attempt cap, then terminal "errored".
      const nextStatus = q.errored ? (attempts >= MAX_ATTEMPTS ? "errored" : "pending") : "rejected";
      await prisma.outreachProspect.update({
        where: { id: prospectId },
        data: {
          status: nextStatus,
          qualified: q.qualified, fitScore: q.fit_score, qualifyReason: q.reasons,
          cleanCompanyName: cleanName, websiteDomain: domainOf(p.website),
        },
      });
      return { prospectId, status: q.errored ? "error" : "rejected", qualified: q.qualified, fitScore: q.fit_score, reason: q.reasons };
    }

    // ── Build + persist the sequence ────────────────────────────────────────────
    const built = await buildSequence({
      firstName:    p.firstName ?? "there",
      businessName: p.companyName,
      cleanName,
      location:     p.location ?? undefined,
      website:      p.website,
      websiteText,
      variantIndex: input.variantIndex,
      callLink:     input.callLink,
    });

    await prisma.$transaction([
      prisma.outreachSequence.deleteMany({ where: { prospectId } }),
      ...built.emails.map((e) =>
        prisma.outreachSequence.create({
          data: {
            prospectId,
            emailNumber: e.emailNumber,
            subject:     e.subject,
            body:        e.body,
            scheduledAt: new Date(e.scheduledAt),
          },
        }),
      ),
      prisma.outreachProspect.update({
        where: { id: prospectId },
        data: {
          status: "generated",
          qualified: true, fitScore: q.fit_score, qualifyReason: q.reasons,
          customHook: built.customHook, cleanCompanyName: cleanName, websiteDomain: domainOf(p.website),
        },
      }),
    ]);

    return { prospectId, status: "generated", qualified: true, fitScore: q.fit_score, customHook: built.customHook, reason: q.reasons };
  } catch (err) {
    console.error("[outreach/persist] processProspect failed:", err instanceof Error ? err.message : err);
    // Respect the attempt cap on the failure path too, so a permanently-failing
    // prospect lands in terminal "errored" rather than retrying forever.
    const fresh = await prisma.outreachProspect.findUnique({ where: { id: prospectId }, select: { attempts: true } }).catch(() => null);
    const terminal = (fresh?.attempts ?? 0) >= MAX_ATTEMPTS;
    await prisma.outreachProspect.update({
      where: { id: prospectId },
      data: { status: terminal ? "errored" : "pending", qualifyReason: err instanceof Error ? err.message.slice(0, 500) : "error" },
    }).catch(() => {});
    return { prospectId, status: "error", qualified: false, fitScore: 0, reason: err instanceof Error ? err.message : "error" };
  }
}
