/**
 * POST /api/outreach/reply
 * The heart of the autonomous layer. Instantly fires this when a PROSPECT REPLIES
 * to a cold email. The agent:
 *   1. matches the reply to an OutreachProspect (by email),
 *   2. runs the safety gate + reply agent (classify → draft → maybe Calendly),
 *   3. sends the reply via Instantly (or hands it to the owner if send isn't wired),
 *   4. updates status, logs the event, and pings the owner on WhatsApp.
 *
 * Public webhook secured by OUTREACH_WEBHOOK_SECRET (bearer, timing-safe). Always
 * returns 200 so Instantly doesn't retry-storm.
 *
 * "Fully auto" mode (the owner's choice): interested/question/objection replies are
 * answered automatically; the safety gate still suppresses opt-outs/legal/hostile
 * and flags them instead — the bot never improvises into trouble.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { decideReply } from "@/lib/outreach/replyAgent";
import { sendReply } from "@/lib/outreach/instantlyClient";
import { notifyOwner } from "@/lib/outreach/notify";
import { logOutreachEvent } from "@/lib/outreach/events";
import { logInbound } from "@/lib/outreach/messages";
import { suppress } from "@/lib/outreach/suppression";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.OUTREACH_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let payload: Record<string, unknown>;
  try { payload = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 200 }); }

  const fromEmail = pick(payload, ["lead_email", "email", "from", "from_email"]).toLowerCase();
  const replyText = pick(payload, ["reply_text", "reply_text_snippet", "text", "body", "message", "reply"]);
  if (!fromEmail) return NextResponse.json({ ok: true, note: "no sender email" }, { status: 200 });

  const prospect = await prisma.outreachProspect.findFirst({
    where:  { contactEmail: { equals: fromEmail, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
  if (!prospect) return NextResponse.json({ ok: true, note: "no matching prospect" }, { status: 200 });

  // Already opted out → never touch again.
  if (prospect.unsubscribed) {
    return NextResponse.json({ ok: true, note: "prospect unsubscribed" }, { status: 200 });
  }

  await logOutreachEvent(prospect.tenantId, "reply_received", replyText.slice(0, 500), prospect.id);
  // Store the inbound reply in the system-of-record.
  await logInbound({ tenantId: prospect.tenantId, prospectId: prospect.id, body: replyText });

  const calendlyLink = process.env.OUTREACH_CALENDLY_LINK || "";
  const decision = await decideReply({
    firstName:    prospect.firstName ?? "there",
    businessName: prospect.cleanCompanyName || prospect.companyName,
    replyText,
    calendlyLink,
  });

  // ── Persist the classification + reply text always ──────────────────────────
  await prisma.outreachProspect.update({
    where: { id: prospect.id },
    data: {
      replyIntent:  decision.intent,
      lastReplyText: replyText.slice(0, 4000),
      repliedAt:    prospect.repliedAt ?? new Date(),
      unsubscribed: decision.unsubscribe ? true : prospect.unsubscribed,
      flagged:      decision.flag ? true : prospect.flagged,
      flagReason:   decision.flag ? decision.flagReason : prospect.flagReason,
      status:       decision.unsubscribe ? "closed" : "replied",
    },
  }).catch(() => {});

  if (decision.unsubscribe) {
    // Permanent do-not-contact — honoured across all campaigns forever.
    await suppress(prospect.tenantId, prospect.contactEmail ?? "", `opt-out via reply: ${decision.flagReason}`, prospect.website);
    await logOutreachEvent(prospect.tenantId, "unsubscribed", prospect.companyName, prospect.id);
    await notifyOwner(decision.summary);
    return NextResponse.json({ ok: true, intent: decision.intent, action: "suppressed" }, { status: 200 });
  }

  const who = prospect.cleanCompanyName || prospect.companyName;

  // ── MANUAL-REPLY MODE (default) — the owner handles all replies ─────────────
  // Auto-replying is OFF unless OUTREACH_AUTO_REPLY="true". We still capture +
  // classify the reply and (above) auto-suppress opt-outs; here we just hand the
  // owner the reply plus a ready-to-paste suggested draft so they can answer.
  const autoReply = process.env.OUTREACH_AUTO_REPLY === "true";
  if (!autoReply) {
    const actionable = decision.intent !== "not_interested" && decision.intent !== "auto";
    if (actionable) {
      await prisma.outreachProspect.update({ where: { id: prospect.id }, data: { flagged: true, flagReason: "reply — manual response needed" } }).catch(() => {});
      await logOutreachEvent(prospect.tenantId, "flagged", `reply received (${decision.intent}) — manual response needed`, prospect.id);
      const draft = decision.draftReply || "(reply in your own words)";
      await notifyOwner(`📩 ${who} replied (${decision.intent}):\n\n"${replyText.slice(0, 400)}"\n\nSuggested reply (send it yourself in Instantly):\n"${draft}"`);
    } else {
      await notifyOwner(decision.summary); // not_interested / auto — just an FYI
    }
    return NextResponse.json({ ok: true, intent: decision.intent, action: "owner_notified", autoReply: false }, { status: 200 });
  }

  // ── AUTO-REPLY MODE (opt-in: OUTREACH_AUTO_REPLY="true") ────────────────────
  let sent = false;
  let handoff = false;
  if (decision.shouldSend && decision.draftReply) {
    if (!calendlyLink && decision.includeCalendly) {
      handoff = true; // wanted to send a link we don't have configured
    } else {
      const res = await sendReply({ toEmail: fromEmail, body: decision.draftReply, leadId: prospect.instantlyLeadId });
      sent = res.ok;
      if (!res.ok) handoff = true; // couldn't send → hand the draft to the owner
    }
  }

  if (sent) {
    await prisma.outreachProspect.update({
      where: { id: prospect.id },
      data: { status: decision.includeCalendly ? "emailing" : "replied", emailsSent: { increment: 1 }, lastEmailAt: new Date() },
    }).catch(() => {});
    await logOutreachEvent(prospect.tenantId, decision.includeCalendly ? "calendly_sent" : "reply_sent", decision.draftReply.slice(0, 500), prospect.id);
    await notifyOwner(decision.summary);
  } else if (handoff) {
    // Couldn't auto-send — flag + give the owner the ready-to-paste draft.
    await prisma.outreachProspect.update({ where: { id: prospect.id }, data: { flagged: true, flagReason: "auto-reply needs manual send" } }).catch(() => {});
    await logOutreachEvent(prospect.tenantId, "flagged", "reply drafted, manual send needed", prospect.id);
    await notifyOwner(`✍️ ${who} replied (${decision.intent}). Draft ready — reply in Instantly:\n\n"${decision.draftReply || "(write a quick reply)"}"`);
  } else {
    // Intent was not_interested / auto / flagged-no-send.
    await notifyOwner(decision.summary);
  }

  return NextResponse.json({ ok: true, intent: decision.intent, action: sent ? "auto_replied" : handoff ? "handoff" : "noted" }, { status: 200 });
}
