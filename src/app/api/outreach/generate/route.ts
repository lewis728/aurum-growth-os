/**
 * POST /api/outreach/generate
 * Manual single-prospect generation. Takes { firstName, businessName, location,
 * website, vertical }, scrapes the site, runs the 2-stage qualifier, and (if it
 * passes) builds the personalised 5-email sequence. Persists an OutreachProspect
 * (+ sequence rows) AND returns the copy-ready emails for immediate paste into
 * Instantly. Tenant-scoped.
 *
 * Even if a prospect is rejected by the qualifier we still return its score +
 * reason so Lewis sees why — but we do NOT generate emails for a reject.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { sanitizeCompanyName } from "@/lib/outreach/nameSanitizer";
import { domainOf } from "@/lib/outreach/websiteText";
import { processProspect } from "@/lib/outreach/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Length-cap all free-text inputs (defence-in-depth against oversized / prompt-
  // injection-y payloads flowing into the LLM and DB).
  const businessName = typeof body.businessName === "string" ? body.businessName.trim().slice(0, 200) : "";
  const website      = typeof body.website === "string" ? body.website.trim().slice(0, 500) : "";
  const firstName    = typeof body.firstName === "string" ? body.firstName.trim().slice(0, 100) : "";
  const location     = typeof body.location === "string" ? body.location.trim().slice(0, 120) : "";
  const vertical     = typeof body.vertical === "string" && body.vertical.trim() ? body.vertical.trim().slice(0, 60) : "aesthetics";

  if (!businessName || !website) {
    return NextResponse.json({ error: "businessName and website are required." }, { status: 400 });
  }

  // Create (or reuse by domain) the prospect row, then run the shared pipeline.
  const domain = domainOf(website);
  let prospect = domain
    ? await prisma.outreachProspect.findFirst({ where: { tenantId, websiteDomain: domain } })
    : null;

  if (!prospect) {
    prospect = await prisma.outreachProspect.create({
      data: {
        tenantId, firstName: firstName || null, companyName: businessName,
        cleanCompanyName: sanitizeCompanyName(businessName) || null,
        website, websiteDomain: domain, location: location || null,
        vertical, source: "manual", status: "pending",
      },
    });
  } else {
    // refresh the inputs the user just typed
    prospect = await prisma.outreachProspect.update({
      where: { id: prospect.id },
      data: { firstName: firstName || prospect.firstName, location: location || prospect.location, vertical },
    });
  }

  const result = await processProspect({ prospectId: prospect.id, tenantId });

  if (result.status !== "generated") {
    return NextResponse.json({
      ok: false,
      rejected: result.status === "rejected",
      fitScore: result.fitScore,
      reason: result.reason,
      error: result.status === "error" ? "Generation failed — please try again." : undefined,
    }, { status: 200 });
  }

  const full = await prisma.outreachProspect.findUnique({
    where:   { id: prospect.id },
    include: { sequences: { orderBy: { emailNumber: "asc" } } },
  });

  const emails = (full?.sequences ?? []).map((s) => ({
    day: [0, 4, 8, 11, 14][s.emailNumber - 1] ?? 0,
    emailNumber: s.emailNumber,
    subject: s.subject,
    body: s.body,
  }));

  return NextResponse.json({
    ok: true,
    prospectId: prospect.id,
    customHook: result.customHook,
    fitScore: result.fitScore,
    emails,
  });
}
