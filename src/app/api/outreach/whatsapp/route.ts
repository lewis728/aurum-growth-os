/**
 * POST /api/outreach/whatsapp
 * The conversational channel — "where you talk to the agent". Twilio posts an
 * inbound WhatsApp message here (form-encoded From/Body). If it's from the owner's
 * number, the agent answers questions about the outreach pipeline in plain English
 * ("how many booked this week?", "what's working?") using GPT-4o over live stats,
 * and replies via TwiML. Non-owner senders are ignored.
 *
 * Twilio inbound webhook → set the WhatsApp number's webhook to this URL.
 * No Clerk (Twilio can't auth); we authorise by matching OUTREACH_OWNER_WHATSAPP.
 */

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { abReport } from "@/lib/outreach/abTuner";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function twiml(message: string): NextResponse {
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`, {
    status: 200, headers: { "Content-Type": "text/xml" },
  });
}

/** Normalises a whatsapp:+44… / +44… number to bare digits for comparison. */
function digits(s: string): string { return (s ?? "").replace(/\D/g, ""); }

export async function POST(req: NextRequest): Promise<NextResponse> {
  let from = "";
  let body = "";
  try {
    const form = await req.formData();
    from = String(form.get("From") ?? "");
    body = String(form.get("Body") ?? "").trim();
  } catch {
    return twiml("Sorry, I couldn't read that.");
  }

  const owner = process.env.OUTREACH_OWNER_WHATSAPP ?? "";
  if (!owner || digits(from) !== digits(owner)) {
    // Not the owner — acknowledge nothing useful.
    return new NextResponse("", { status: 200 });
  }

  // Resolve the owner's tenant (the one with outreach data). Single-tenant in
  // practice; if several, use the most active.
  const tenantRow = await prisma.outreachProspect
    .groupBy({ by: ["tenantId"], _count: { _all: true }, orderBy: { _count: { tenantId: "desc" } }, take: 1 })
    .catch(() => [] as { tenantId: string }[]);
  const tenantId = tenantRow[0]?.tenantId;
  if (!tenantId) return twiml("No outreach data yet — once leads start flowing I'll have plenty to tell you.");

  // Gather live stats.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [pending, generated, emailing, replied, booked7, bookedAll, ab] = await Promise.all([
    prisma.outreachProspect.count({ where: { tenantId, status: "pending" } }),
    prisma.outreachProspect.count({ where: { tenantId, status: "generated" } }),
    prisma.outreachProspect.count({ where: { tenantId, status: "emailing" } }),
    prisma.outreachProspect.count({ where: { tenantId, status: "replied" } }),
    prisma.outreachProspect.count({ where: { tenantId, bookedAt: { gte: weekAgo } } }),
    prisma.outreachProspect.count({ where: { tenantId, status: "booked" } }),
    abReport(tenantId),
  ]);

  const stats = [
    `Pending (not yet emailed): ${pending}`,
    `Generated (ready to send): ${generated}`,
    `In active sequences: ${emailing}`,
    `Replied: ${replied}`,
    `Demos booked this week: ${booked7}`,
    `Demos booked all-time: ${bookedAll}`,
    `A/B: best subject is variant ${ab.bestVariant + 1}; reply rates ${ab.variants.map((v) => `${v.variant + 1}:${Math.round(v.replyRate * 100)}%`).join(" ")}`,
  ].join("\n");

  if (!process.env.OPENAI_API_KEY) {
    return twiml(stats); // raw stats if the LLM is offline
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 200,
      messages: [
        { role: "system", content: "You are Lewis's outreach employee, answering over WhatsApp. Be brief, concrete, and human. Use the stats provided to answer his question directly. Plain text, no markdown." },
        { role: "user", content: `My question: ${body}\n\nLive outreach stats:\n${stats}` },
      ],
    });
    return twiml(completion.choices[0]?.message?.content?.trim() || stats);
  } catch {
    return twiml(stats);
  }
}
