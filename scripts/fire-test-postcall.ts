/**
 * scripts/fire-test-postcall.ts
 * Simulates a Retell POST-CALL webhook to test the booking + SMS + calendar leg
 * WITHOUT a real call. Signs the payload with RETELL_WEBHOOK_SECRET and posts to
 * /api/webhooks/calls/[blueprintId], exactly as Retell would after a call.
 *
 *   RETELL_WEBHOOK_SECRET=... npm run fire-postcall -- \
 *     --blueprintId <id> --phone +447488232678 \
 *     [--callId call_xxx] [--leadId <id>] [--slot <ISO>] [--outcome booked|qualified]
 *
 * Lead resolution mirrors the webhook: call_id → leadId → phone+blueprint.
 * ⚠️ "booked" sends a REAL confirmation SMS to --phone via Twilio.
 *    Note: Appointment.leadId is unique — a lead that already has an appointment
 *    will no-op (the webhook catches the unique-constraint error).
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BASE_URL = "https://aurum-growth-os.vercel.app";

function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* rely on exported env */ }
}

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const blueprintId = getArg("blueprintId");
  const phone       = getArg("phone");
  const callId      = getArg("callId");
  const leadId      = getArg("leadId");
  const outcome     = getArg("outcome") ?? "booked"; // booked | qualified
  const baseUrl     = (getArg("url") ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const secret      = process.env.RETELL_WEBHOOK_SECRET;

  // Default slot: 2 days from now at 14:00 local-ish (UTC), well in the future.
  const defaultSlot = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  defaultSlot.setUTCHours(14, 0, 0, 0);
  const slot = getArg("slot") ?? defaultSlot.toISOString();

  if (!blueprintId) { console.error("❌ Missing --blueprintId"); process.exit(1); }
  if (!phone)       { console.error("❌ Missing --phone (the lead's number — gets the confirmation SMS)"); process.exit(1); }
  if (!secret)      { console.error("❌ RETELL_WEBHOOK_SECRET not in env / .env.local"); process.exit(1); }
  if (!callId && !leadId) { console.error("❌ Provide --callId (preferred) or --leadId so the webhook can resolve the lead"); process.exit(1); }

  const booked = outcome === "booked";

  // Realistic Retell post-call payload shape (matches the webhook's parser).
  const payload: Record<string, unknown> = {
    event:   "call_analyzed",
    call_id: callId ?? `sim_${Date.now()}`,
    transcript:
      "Agent: Hi, it's Bella from Lewis Roofing — you just enquired about a new roof. " +
      "Lead: Yes, hi. Agent: Great, are you the homeowner? Lead: Yes. " +
      "Agent: Perfect, I can book you a free inspection. Does Thursday at 2pm work? Lead: Yes that's great.",
    custom_analysis_data: {
      isQualified:        true,
      appointmentBooked:  booked,
      appointmentSlotTime: booked ? slot : undefined,
      ptName:             "Test Lead",
      leadPhone:          phone,
      ...(leadId ? { leadId } : {}),
    },
  };

  const body      = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  const url       = `${baseUrl}/api/webhooks/calls/${blueprintId}`;

  console.log(`→ POST ${url}`);
  console.log(`  outcome=${outcome}  ${booked ? `slot=${slot}` : ""}  resolve=${callId ? `call_id=${callId}` : `leadId=${leadId}`}`);

  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-retell-signature": signature },
    body,
  });
  const text = await res.text();
  console.log(`← ${res.status} ${res.statusText}`);
  console.log(`  ${text}`);

  if (res.ok) {
    console.log("\n✅ Webhook accepted (returns 200 immediately; booking/SMS run async).");
    console.log("   Check: Appointment row created, Lead.status='booked', confirmation SMS to your phone.");
  } else {
    console.log("\n❌ Rejected. 401 = signature/secret mismatch.");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
