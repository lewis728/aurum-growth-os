/**
 * src/lib/services/clientUpdateService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * The weekly client WhatsApp update (Sprint 10). Every Monday 9am, for each live
 * client that has a WhatsApp number on file, GPT-4o writes a short, warm update
 * from the previous week's real numbers and sends it under the AGENCY's brand —
 * never the platform's. The message + outcome is logged as a ClientMessage so it
 * shows in the sub-account thread.
 *
 * NEVER THROWS at the per-client level — generateWeeklyUpdate handles one client
 * and the caller (cron) iterates with Promise.allSettled.
 */

import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import { safeWhatsApp } from "@/lib/services/twilioService";
import { getBranding } from "@/lib/services/brandingService";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyUpdateResult {
  blueprintId: string;
  status: "sent" | "skipped_no_number" | "skipped_no_data" | "skipped_no_openai" | "error";
}

/**
 * Generates and sends one client's weekly WhatsApp update. NEVER THROWS.
 */
export async function generateWeeklyClientUpdate(
  blueprintId: string,
  tenantId: string,
): Promise<WeeklyUpdateResult> {
  try {
    const [blueprint, brief] = await Promise.all([
      prisma.campaignBlueprint.findFirst({
        where:  { id: blueprintId, tenantId },
        select: { businessName: true },
      }),
      prisma.clientBrief.findUnique({
        where:  { blueprintId },
        select: { clientWhatsApp: true, clientContactName: true, brandTone: true },
      }),
    ]);
    if (!blueprint) return { blueprintId, status: "error" };

    const toNumber = brief?.clientWhatsApp?.trim();
    if (!toNumber) return { blueprintId, status: "skipped_no_number" };

    const since = new Date(Date.now() - WEEK_MS);
    const [leads, booked] = await Promise.all([
      prisma.lead.count({ where: { blueprintId, tenantId, createdAt: { gte: since } } }),
      prisma.appointment.count({ where: { blueprintId, tenantId, createdAt: { gte: since } } }),
    ]);

    // Nothing happened — don't send an empty "0 leads" message.
    if (leads === 0 && booked === 0) return { blueprintId, status: "skipped_no_data" };
    if (!process.env.OPENAI_API_KEY) return { blueprintId, status: "skipped_no_openai" };

    const branding   = await getBranding(tenantId).catch(() => null);
    const agencyName = branding?.agencyName ?? "Your Marketing Team";
    const contact    = brief?.clientContactName?.trim() || "there";
    const tone       = brief?.brandTone?.trim() || "warm and professional";

    const completion = await openai.chat.completions.create({
      model:       "gpt-4o",
      temperature: 0.6,
      max_tokens:  220,
      messages: [
        {
          role: "system",
          content:
            `You write a short weekly WhatsApp update FROM the marketing agency "${agencyName}" TO their ` +
            `client at "${blueprint.businessName}". 2-3 sentences, ${tone}, first-person plural ("we"). ` +
            `Lead with results. NEVER mention any technology vendor, never mention "Aurum", never imply it's ` +
            `automated. No emojis unless the tone clearly calls for one. End warmly.`,
        },
        {
          role: "user",
          content:
            `Recipient first name: ${contact}\nLast 7 days: ${leads} new leads, ${booked} appointments booked. ` +
            `Write the WhatsApp message now.`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { blueprintId, status: "error" };

    const sid = await safeWhatsApp(toNumber, text);
    if (!sid) return { blueprintId, status: "error" };

    // Log to the message thread (outbound, whatsapp channel).
    await prisma.clientMessage.create({
      data: {
        blueprintId, tenantId, direction: "outbound", channel: "whatsapp",
        intent: "praise", content: text, sentAt: new Date(),
      },
    }).catch(() => { /* non-fatal */ });

    return { blueprintId, status: "sent" };
  } catch (err) {
    console.error(`[clientUpdateService] weekly update failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { blueprintId, status: "error" };
  }
}
