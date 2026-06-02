/**
 * src/lib/outreach/verify.ts
 * SERVER-SIDE ONLY. The "brutally verified" gate — confirms a mailbox actually
 * exists BEFORE we ever send, so bounce rates stay low enough to protect the
 * sending domains. This is the proactive layer (suppression is the reactive one).
 *
 * Provider-agnostic: OUTREACH_VERIFIER selects the provider (default
 * "millionverifier"); the matching API key enables it. With NO key configured the
 * verifier is GRACEFUL — it returns status "skipped" and lets the lead through, so
 * the pipeline still runs end-to-end and you can rely on Clay's own verification
 * plus the role-inbox guard until you add a key.
 *
 * STRICT by design: when a verifier IS configured, ONLY a clean "valid" is
 * sendable — catch-all, risky, invalid, and unknown are all dropped. NEVER THROWS.
 */

import { withRetry, isTransientError } from "@/lib/utils/withRetry";

export type VerificationStatus =
  | "valid"      // mailbox exists and accepts mail → send
  | "catch_all"  // domain accepts everything → can't confirm the person → drop
  | "risky"      // disposable / low-quality → drop
  | "invalid"    // does not exist → drop + worth suppressing
  | "unknown"    // verifier couldn't decide → drop (strict)
  | "skipped";   // no verifier configured → not checked (let through)

export interface VerifyResult {
  status:   VerificationStatus;
  sendable: boolean;   // true only for "valid" (or "skipped" when no verifier set)
  provider: string;    // which verifier answered ("none" when skipped)
  isRole?:  boolean;    // provider also flagged a role inbox (bonus signal)
}

function provider(): string {
  return (process.env.OUTREACH_VERIFIER ?? "millionverifier").trim().toLowerCase();
}

/** True when a verifier provider + key are configured (strict gate is then active). */
export function verifierConfigured(): boolean {
  const p = provider();
  if (p === "millionverifier") return Boolean(process.env.MILLIONVERIFIER_API_KEY);
  if (p === "none") return false;
  // Unknown provider names are treated as not-configured (graceful).
  return false;
}

const SKIPPED: VerifyResult = { status: "skipped", sendable: true, provider: "none" };

interface MillionVerifierResponse {
  result?: string;       // ok | catch_all | unknown | error | disposable | invalid
  resultcode?: number;
  role?: boolean;
}

/** Maps MillionVerifier's `result` to our normalised status. */
function mapMillionVerifier(result: string | undefined): VerificationStatus {
  switch ((result ?? "").toLowerCase()) {
    case "ok":         return "valid";
    case "catch_all":  return "catch_all";
    case "disposable": return "risky";
    case "invalid":    return "invalid";
    default:           return "unknown"; // "unknown" | "error" | anything else
  }
}

async function verifyMillionVerifier(email: string): Promise<VerifyResult> {
  const key = process.env.MILLIONVERIFIER_API_KEY;
  if (!key) return SKIPPED;
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&timeout=10`;
  try {
    const data = await withRetry(
      async () => {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as MillionVerifierResponse;
      },
      { maxAttempts: 2, baseDelayMs: 500, label: "millionverifier.verify", shouldRetry: isTransientError },
    );
    const status = mapMillionVerifier(data.result);
    return { status, sendable: status === "valid", provider: "millionverifier", isRole: data.role === true };
  } catch (err) {
    console.error("[verify] millionverifier failed:", err instanceof Error ? err.message : err);
    // On a hard verifier failure, return "unknown" (strict → not sendable) rather
    // than letting an unchecked address through when verification was REQUESTED.
    return { status: "unknown", sendable: false, provider: "millionverifier" };
  }
}

/**
 * Verifies one email. NEVER THROWS. Returns "skipped"/sendable when no verifier is
 * configured; otherwise a strict verdict where only "valid" is sendable.
 */
export async function verifyEmail(email: string | null | undefined): Promise<VerifyResult> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return { status: "invalid", sendable: false, provider: "none" };
  if (!verifierConfigured()) return SKIPPED;
  if (provider() === "millionverifier") return verifyMillionVerifier(e);
  return SKIPPED;
}
