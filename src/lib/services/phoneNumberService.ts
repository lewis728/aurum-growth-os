/**
 * src/lib/services/phoneNumberService.ts
 * SERVER-SIDE ONLY.
 *
 * ── PER-CLIENT DEDICATED CALLER ID (Sprint 14) ──────────────────────────────
 * At Deploy Sophie, each client gets its own UK mobile number so every call
 * shows a consistent caller ID. We buy it from Twilio, import it into Retell and
 * bind it to the client's agent, then store it on AIRepresentative.
 *
 * GUARANTEES:
 *  - Idempotent — never purchases twice for the same blueprint (guarded by the
 *    existing AIRepresentative.twilioPhoneNumber).
 *  - Graceful — if Twilio isn't configured, no number is available, or any step
 *    fails, it returns without a number and the caller falls back to the shared
 *    RETELL_FROM_NUMBER. NEVER THROWS.
 */

import { prisma } from "@/lib/prisma";
import { importTwilioNumberToRetell } from "@/lib/services/retellService";

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function twilioAuthHeader(): string {
  return "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
}

/** Finds one available UK mobile number (voice + SMS capable). */
async function findAvailableUkMobile(): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const url = `${TWILIO_BASE}/Accounts/${sid}/AvailablePhoneNumbers/GB/Mobile.json?VoiceEnabled=true&SmsEnabled=true&PageSize=1`;
  const res = await fetch(url, { headers: { Authorization: twilioAuthHeader() } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio number search failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(await res.text()) as { available_phone_numbers?: { phone_number?: string }[] };
  return data.available_phone_numbers?.[0]?.phone_number ?? null;
}

/** Purchases a specific number on the Twilio account. Returns the E.164 number. */
async function purchaseNumber(phoneNumber: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const url = `${TWILIO_BASE}/Accounts/${sid}/IncomingPhoneNumbers.json`;
  const params = new URLSearchParams({ PhoneNumber: phoneNumber });
  const res = await fetch(url, {
    method:  "POST",
    headers: {
      Authorization: twilioAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      // Idempotency: a retried purchase of the SAME number must not double-charge.
      "Idempotency-Key": `buy:${phoneNumber}`,
    },
    body:    params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio number purchase failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (JSON.parse(await res.text()) as { phone_number: string }).phone_number;
}

export interface PhoneProvisionResult {
  ok:          boolean;
  phoneNumber: string | null;
  alreadyDone?: boolean;
  fellBack?:   boolean;   // true when we intentionally left the client on the shared number
  error?:      string;
}

/**
 * Provisions (or returns the existing) dedicated number for a client. NEVER THROWS.
 */
export async function provisionClientPhoneNumber(
  blueprintId: string,
  agentId: string,
): Promise<PhoneProvisionResult> {
  try {
    const rep = await prisma.aIRepresentative.findUnique({
      where:  { blueprintId },
      select: { repName: true, twilioPhoneNumber: true },
    });

    // Idempotency: already has a dedicated number.
    if (rep?.twilioPhoneNumber) {
      return { ok: true, phoneNumber: rep.twilioPhoneNumber, alreadyDone: true };
    }

    // Graceful: no Twilio credentials → stay on the shared number.
    if (!twilioConfigured()) {
      return { ok: true, phoneNumber: null, fellBack: true, error: "twilio_not_configured" };
    }

    const available = await findAvailableUkMobile();
    if (!available) {
      return { ok: true, phoneNumber: null, fellBack: true, error: "no_uk_mobile_available" };
    }

    const purchased = await purchaseNumber(available);

    // Register with Retell so it can be used as this client's caller ID.
    let phoneNumberId: string | null = null;
    try {
      phoneNumberId = await importTwilioNumberToRetell({
        phoneNumber: purchased,
        agentId,
        nickname:    rep?.repName ? `${rep.repName} · ${blueprintId}` : blueprintId,
      });
    } catch (err) {
      // The number is bought but Retell import failed — persist it anyway so we
      // never re-purchase, and surface the issue. Calls fall back until fixed.
      console.error(`[phoneNumber] Retell import failed for ${purchased}:`, err instanceof Error ? err.message : err);
    }

    await prisma.aIRepresentative.update({
      where: { blueprintId },
      data:  { twilioPhoneNumber: purchased, retellPhoneNumberId: phoneNumberId },
    });

    return { ok: Boolean(phoneNumberId), phoneNumber: purchased, fellBack: !phoneNumberId, error: phoneNumberId ? undefined : "retell_import_failed" };
  } catch (err) {
    console.error(`[phoneNumber] provision failed for blueprint ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { ok: false, phoneNumber: null, fellBack: true, error: err instanceof Error ? err.message : "error" };
  }
}

/**
 * Resolves the caller ID for a client's outbound calls: the dedicated number if
 * provisioned, else the shared RETELL_FROM_NUMBER. Returns null if neither exists.
 */
export async function resolveClientFromNumber(blueprintId: string): Promise<string | null> {
  const rep = await prisma.aIRepresentative.findUnique({
    where:  { blueprintId },
    select: { twilioPhoneNumber: true },
  });
  return rep?.twilioPhoneNumber ?? process.env.RETELL_FROM_NUMBER ?? null;
}
