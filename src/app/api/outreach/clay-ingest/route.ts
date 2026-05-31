/**
 * POST /api/outreach/clay-ingest
 * Module 1 — inbound webhook for enriched leads from Clay. Public endpoint (Clay
 * can't carry a Clerk session) secured by a shared secret: the request must send
 * `Authorization: Bearer <OUTREACH_WEBHOOK_SECRET>` or `?secret=`. The tenant is
 * resolved from OUTREACH_DEFAULT_TENANT (this is Lewis's own agency outbound).
 *
 * Flow: sanitize company_name → dedupe by domain → create prospect → run the
 * shared pipeline (qualify → if accepted, hook + 5-email sequence). With the
 * chosen "generate + 1-click approve" model, the lead lands in `generated` (or
 * `rejected`) for review — it is NOT auto-pushed to Instantly here.
 *
 * Always returns 200 to the webhook (with a detail body) so Clay doesn't retry-storm.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { sanitizeCompanyName } from "@/lib/outreach/nameSanitizer";
import { domainOf } from "@/lib/outreach/websiteText";
import { processProspect } from "@/lib/outreach/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time string compare (avoids leaking the secret via timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Authorise via Bearer token ONLY — never a query string (those leak into access
// logs, browser history, and referrers).
function authorised(req: NextRequest): boolean {
  const secret = process.env.OUTREACH_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), secret);
}

/** Pulls a field from Clay's flexible payload by trying several key spellings. */
function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tenantId = process.env.OUTREACH_DEFAULT_TENANT;
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "OUTREACH_DEFAULT_TENANT not configured" }, { status: 200 });
  }

  let payload: Record<string, unknown>;
  try { payload = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 200 }); }

  const companyName = pick(payload, ["company_name", "companyName", "company", "organization", "business_name"]);
  const website     = pick(payload, ["website", "website_url", "domain", "url"]);
  const firstName   = pick(payload, ["first_name", "firstName", "contact_first_name"]);
  const lastName    = pick(payload, ["last_name", "lastName"]);
  const email       = pick(payload, ["email", "contact_email", "email_address"]);
  const location    = pick(payload, ["city", "location", "town"]);
  const vertical    = pick(payload, ["vertical", "category"]) || "aesthetics";

  if (!companyName && !website) {
    return NextResponse.json({ ok: false, error: "company_name or website required" }, { status: 200 });
  }

  const domain = domainOf(website);

  // Dedup by domain (within tenant).
  if (domain) {
    const existing = await prisma.outreachProspect.findFirst({ where: { tenantId, websiteDomain: domain }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, prospectId: existing.id }, { status: 200 });
    }
  }

  let prospect;
  try {
    prospect = await prisma.outreachProspect.create({
      data: {
        tenantId,
        firstName: firstName || null,
        lastName:  lastName || null,
        companyName: companyName || domain || "(unknown)",
        cleanCompanyName: sanitizeCompanyName(companyName) || null,
        website: website || "",
        websiteDomain: domain,
        contactEmail: email || null,
        location: location || null,
        vertical,
        source: "clay",
        status: "pending",
      },
    });
  } catch (err) {
    console.error("[clay-ingest] create failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "could not store lead" }, { status: 200 });
  }

  // Run the shared pipeline (qualify → hook + sequence). Never throws.
  const result = await processProspect({ prospectId: prospect.id, tenantId });

  return NextResponse.json({
    ok: true,
    prospectId: prospect.id,
    status: result.status,
    qualified: result.qualified,
    fitScore: result.fitScore,
  }, { status: 200 });
}
