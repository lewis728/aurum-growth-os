/**
 * scripts/fire-test-lead.ts
 * Fires ONE signed test lead at the leads webhook to exercise the full
 * speed-to-lead call flow without any UI.
 *
 *   npm run fire-lead -- --blueprintId <id> --phone +447700900123 [--url <base>]
 *
 * Signs the JSON body with HMAC-SHA256 using LEAD_WEBHOOK_SECRET (NOT
 * WEBHOOK_SECRET — the webhook validates LEAD_WEBHOOK_SECRET) and sends it in
 * the `x-aurum-signature: sha256=<hex>` header, exactly as the webhook expects.
 *
 * ⚠️ This places a REAL phone call (and SMS) to --phone via the live deployment.
 *    Use your own number. The blueprint must be status="live" or the call no-ops.
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BASE_URL = "https://aurum-growth-os.vercel.app";

// ── Minimal .env.local loader (no dotenv dependency) ────────────────────────────
function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // No .env.local — rely on already-exported env vars.
  }
}

// ── Arg parsing ─────────────────────────────────────────────────────────────────
function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const blueprintId = getArg("blueprintId");
  const phone       = getArg("phone");
  const baseUrl     = (getArg("url") ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const secret      = process.env.LEAD_WEBHOOK_SECRET;

  if (!blueprintId) { console.error("❌ Missing required --blueprintId"); process.exit(1); }
  if (!phone)       { console.error("❌ Missing required --phone (E.164, e.g. +447700900123) — use YOUR number"); process.exit(1); }
  if (!secret)      { console.error("❌ LEAD_WEBHOOK_SECRET not found in env / .env.local"); process.exit(1); }
  if (typeof fetch !== "function") { console.error("❌ global fetch unavailable — needs Node 18+"); process.exit(1); }

  const payload = {
    firstName: "Test",
    lastName:  "Lead",
    phone,
    email:     "test@test.com",
    // schema strips unknown top-level keys, so test markers live in formData
    formData:  { source: "fire-test-lead", fillDurationMs: 15000 },
  };

  // Sign the EXACT bytes we send — re-stringifying differently would break the HMAC.
  const body      = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  const url       = `${baseUrl}/api/webhooks/leads/${blueprintId}`;

  console.log(`→ POST ${url}`);
  console.log(`  phone=${phone}  bodyBytes=${Buffer.byteLength(body)}`);

  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-aurum-signature": signature },
    body,
  });
  const text = await res.text();

  console.log(`← ${res.status} ${res.statusText}`);
  console.log(`  ${text}`);

  if (res.ok) {
    console.log("\n✅ Lead accepted. If the blueprint is LIVE and Retell is configured,");
    console.log("   your phone should ring within ~60s. Check AgentAction rows for");
    console.log("   CALL_INITIATED (success) or CALL_FAILED (misconfig).");
  } else {
    console.log("\n❌ Webhook rejected the lead. 401 = signature/secret mismatch;");
    console.log("   404 = blueprintId not found; 400 = payload invalid.");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
