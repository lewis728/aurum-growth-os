/**
 * src/lib/outreach/notify.ts
 * SERVER-SIDE ONLY. The owner's notification channel — WhatsApp (so Lewis never
 * opens the app). Reuses the existing Twilio safeWhatsApp (never throws).
 *
 * The owner's number is OUTREACH_OWNER_WHATSAPP (E.164). When unset, notifications
 * no-op silently — the agent still works, you just won't get the pings.
 */

import { safeWhatsApp } from "@/lib/services/twilioService";

export function ownerNotifyConfigured(): boolean {
  return Boolean(process.env.OUTREACH_OWNER_WHATSAPP);
}

/** Texts the owner. Returns true if a message was actually sent. Never throws. */
export async function notifyOwner(message: string): Promise<boolean> {
  const to = process.env.OUTREACH_OWNER_WHATSAPP;
  if (!to) return false;
  const sid = await safeWhatsApp(to, message);
  return sid !== null;
}
