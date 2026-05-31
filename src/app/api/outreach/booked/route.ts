/**
 * POST /api/outreach/booked
 * Fired when a prospect books via the outreach Calendly link. Marks the prospect
 * 'booked', logs it, and sends the owner the WhatsApp ping they actually care
 * about: "💰 new demo booked". Public webhook (Calendly can't carry a Clerk
 * session) secured by OUTREACH_WEBHOOK_SECRET (bearer, timing-safe).
 *
 * NOTE: the existing /api/webhooks/calendly route already books CLIENT leads into
 * Appointments. This route is specifically for OUTREACH prospects (Lewis's own
 * pipeline) — point the outreach Calendly event type's webhook here. Always 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/outreach/notify";
import { logOutreachEvent } from "@/lib/outreach/events";

export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.OUTREACH_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function deepFindEmail(obj: unknown, depth = 0): string {
  if (depth > 4 || !obj || typeof obj !== "object") return "";
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === "string" && /email/i.test(k) && v.includes("@")) return v.trim().toLowerCase();
    if (typeof v === "object") { const found = deepFindEmail(v, depth + 1); if (found) return found; }
  }
  return "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let payload: Record<string, unknown>;
  try { payload = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 200 }); }

  // Accept an explicit email, else dig it out of a Calendly invitee payload.
  const email = (typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "") || deepFindEmail(payload);
  const whenRaw = typeof payload.start_time === "string" ? payload.start_time : "";
  const when = whenRaw ? new Date(whenRaw) : new Date();

  if (!email) return NextResponse.json({ ok: true, note: "no email in payload" }, { status: 200 });

  const prospect = await prisma.outreachProspect.findFirst({
    where: { contactEmail: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
  if (!prospect) return NextResponse.json({ ok: true, note: "no matching prospect" }, { status: 200 });

  await prisma.outreachProspect.update({
    where: { id: prospect.id },
    data:  { status: "booked", bookedAt: when },
  }).catch(() => {});

  await logOutreachEvent(prospect.tenantId, "booked", `demo at ${when.toISOString()}`, prospect.id);

  const niceWhen = when.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  await notifyOwner(`💰 NEW DEMO BOOKED — ${prospect.cleanCompanyName || prospect.companyName} for ${niceWhen}. Nice one.`);

  return NextResponse.json({ ok: true, booked: true }, { status: 200 });
}
