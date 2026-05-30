/**
 * src/lib/services/retellService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Manages Retell AI voice agent configuration.
 * Every external call is wrapped in withRetry() per GR-02.
 */

import { withRetry } from "@/lib/utils/withRetry";

const RETELL_BASE_URL = "https://api.retellai.com";

function getRetellApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not configured");
  return key;
}

/**
 * Normalises a phone number to E.164. Defaults to UK (+44) when no country
 * code is present, since Aurum's launch market is the UK.
 * Returns null if the number can't be salvaged into a plausible E.164 string.
 */
export function toE164(raw: string, defaultCountry: "GB" = "GB"): string | null {
  const trimmed = raw.trim();
  // Already E.164
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;

  // Strip everything except digits and a leading +
  let digits = trimmed.replace(/[^\d+]/g, "");

  // International prefix written as 00 → +
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (digits.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
  }

  if (defaultCountry === "GB") {
    // UK local format: drop a single leading 0, prepend +44
    const national = digits.replace(/^0/, "");
    if (national.length < 7 || national.length > 12) return null;
    return `+44${national}`;
  }

  return null;
}

// ── Outbound call ───────────────────────────────────────────────────────────────

export interface CreatePhoneCallParams {
  fromNumber:       string;
  toNumber:         string;
  agentId:          string;
  dynamicVariables: Record<string, string>;
}

export interface CreatePhoneCallResult {
  callId: string;
}

/**
 * Places an outbound phone call via Retell — POST /v2/create-phone-call.
 * Used for speed-to-lead: Sophie calls a fresh lead within 60 seconds.
 * Returns the Retell call_id so it can be persisted on the Lead.
 */
export async function createPhoneCall(
  params: CreatePhoneCallParams
): Promise<CreatePhoneCallResult> {
  const apiKey = getRetellApiKey();

  return withRetry(
    async () => {
      const res = await fetch(`${RETELL_BASE_URL}/v2/create-phone-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from_number:                  params.fromNumber,
          to_number:                    params.toNumber,
          override_agent_id:            params.agentId,
          retell_llm_dynamic_variables: params.dynamicVariables,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          `Retell create-phone-call failed: HTTP ${res.status} — ${body.message ?? "unknown error"}`
        );
      }

      const data = (await res.json()) as { call_id?: string };
      if (!data.call_id) throw new Error("Retell create-phone-call returned no call_id");
      return { callId: data.call_id };
    },
    { maxAttempts: 2, baseDelayMs: 500, label: "retellService.createPhoneCall" }
  );
}

/**
 * Updates the Retell AI agent's system prompt via PATCH /update-agent/{agentId}.
 * The update is idempotent — safe to retry on failure.
 * Each campaign blueprint maps to exactly one Retell agent ID.
 */
export async function updateRetellAgent(
  agentId: string,
  systemPrompt: string
): Promise<void> {
  const apiKey = getRetellApiKey();

  await withRetry(
    async () => {
      const res = await fetch(`${RETELL_BASE_URL}/update-agent/${agentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          general_prompt: systemPrompt,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          `Retell API error updating agent ${agentId}: HTTP ${res.status} — ${body.message ?? "unknown error"}`
        );
      }
    },
    { maxAttempts: 3, baseDelayMs: 500, label: "retellService.updateRetellAgent" }
  );
}
