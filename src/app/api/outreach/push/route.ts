/**
 * POST /api/outreach/push
 * The "1-click approve" step: pushes selected generated prospects into Instantly.
 * Takes { prospectIds: string[] } (or { all: true } to push every 'generated'
 * prospect). Only prospects with status 'generated', a custom hook, and a contact
 * email are eligible. On success the prospect moves to 'emailing' and stores its
 * Instantly lead id. Tenant-scoped.
 *
 * Deliverability throttling (daily caps, delay, warmup) is Instantly's job — we
 * just inject; Instantly drip-sends.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { injectLeads, instantlyConfigured, type InstantlyLead } from "@/lib/outreach/instantlyClient";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: { prospectIds?: unknown; all?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { body = {}; }

  const ids = Array.isArray(body.prospectIds) ? body.prospectIds.filter((x): x is string => typeof x === "string") : [];
  const pushAll = body.all === true;

  if (!pushAll && ids.length === 0) {
    return NextResponse.json({ error: "Provide prospectIds[] or { all: true }." }, { status: 400 });
  }

  const prospects = await prisma.outreachProspect.findMany({
    where: {
      tenantId,
      status: "generated",
      contactEmail: { not: null },
      ...(pushAll ? {} : { id: { in: ids } }),
    },
    select: { id: true, firstName: true, companyName: true, cleanCompanyName: true, contactEmail: true, customHook: true },
  });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const eligible = prospects.filter((p) => p.contactEmail && EMAIL_RE.test(p.contactEmail) && p.customHook);
  if (eligible.length === 0) {
    return NextResponse.json({
      ok: false,
      pushed: 0,
      error: "No eligible prospects (need status 'generated', an email, and a generated hook).",
    }, { status: 200 });
  }

  if (!instantlyConfigured()) {
    return NextResponse.json({
      ok: false, pushed: 0, notConfigured: true,
      error: "Instantly not configured (set INSTANTLY_API_KEY and INSTANTLY_CAMPAIGN_ID). Sequences are generated and ready to export.",
      eligible: eligible.length,
    }, { status: 200 });
  }

  const leads: InstantlyLead[] = eligible.map((p) => ({
    email:             p.contactEmail as string,
    first_name:        p.firstName ?? "there",
    custom_hook:       p.customHook ?? "",
    custom_clean_name: p.cleanCompanyName ?? p.companyName,
  }));

  const result = await injectLeads(leads);

  // Persist successes: move to 'emailing', store the Instantly lead id.
  await Promise.all(
    eligible.map((p, i) => {
      const leadId = result.leadIds[i];
      if (!leadId) return Promise.resolve();
      return prisma.outreachProspect.update({
        where: { id: p.id },
        data:  { status: "emailing", instantlyLeadId: leadId, emailsSent: 1, lastEmailAt: new Date() },
      }).catch(() => {});
    }),
  );

  return NextResponse.json({ ok: result.ok, pushed: result.injected, failed: result.failed });
}
