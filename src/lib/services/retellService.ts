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
        // Capture the RAW body — Retell often returns the real reason in a
        // non-{message} shape, which the previous parse swallowed as "unknown".
        const rawErr = await res.text().catch(() => "");
        throw new Error(
          `Retell create-phone-call failed: HTTP ${res.status} — ${rawErr || "no body"}`
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

// ── Agent provisioning (create-from-scratch) ────────────────────────────────────
//
// Retell models an agent in TWO objects:
//   1. a "Retell LLM"  — holds the general_prompt + model + begin_message
//   2. an "agent"      — binds that LLM (response_engine) to a voice + webhook
// To create a dedicated agent you create the LLM first, then the agent that
// references it. The prompt is later updated on the LLM (NOT the agent).

/**
 * Maps our internal voice aliases to real Retell voice IDs. Real Retell IDs
 * (e.g. "11labs-Adrian") are passed through untouched. Unknown values fall back
 * to a safe default so provisioning never fails on a bad alias.
 */
export function resolveRetellVoiceId(voiceId: string | null | undefined): string {
  const DEFAULT = "11labs-Adrian";
  if (!voiceId) return DEFAULT;
  const v = voiceId.trim();
  // Already a provider-prefixed Retell voice id — pass through.
  if (v.includes("-") && /^(11labs|openai|deepgram|elevenlabs|play)/i.test(v)) return v;
  const ALIASES: Record<string, string> = {
    "female-british": "11labs-Lily",
    "male-british":   "11labs-Oliver",
    "female-us":      "11labs-Anna",
    "male-us":        "11labs-Adrian",
  };
  return ALIASES[v.toLowerCase()] ?? DEFAULT;
}

interface CreateLlmParams {
  generalPrompt: string;
  beginMessage?: string;
  model?:        string;
}

interface CreateLlmResponse {
  llm_id: string;
}

/**
 * Creates a Retell LLM holding the agent's system prompt.
 * POST /create-retell-llm
 */
export async function createRetellLlm(params: CreateLlmParams): Promise<{ llmId: string }> {
  const apiKey = getRetellApiKey();

  const body: Record<string, unknown> = {
    model:          params.model ?? "gpt-4o",
    general_prompt: params.generalPrompt,
  };
  if (params.beginMessage) body.begin_message = params.beginMessage;

  const data = await withRetry(
    async () => {
      const res = await fetch(`${RETELL_BASE_URL}/create-retell-llm`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          `Retell API error creating LLM: HTTP ${res.status} — ${errBody.message ?? "unknown"}`
        );
      }
      return (await res.json()) as CreateLlmResponse;
    },
    { maxAttempts: 3, baseDelayMs: 500, label: "retellService.createRetellLlm" }
  );

  if (!data.llm_id) throw new Error("Retell create-llm returned no llm_id");
  return { llmId: data.llm_id };
}

interface CreateAgentParams {
  llmId:       string;
  voiceId:     string;
  agentName:   string;
  webhookUrl?: string;
  language?:   string;
}

interface CreateAgentResponse {
  agent_id: string;
}

/**
 * Creates a Retell agent bound to an existing Retell LLM.
 * POST /create-agent
 */
export async function createRetellAgent(params: CreateAgentParams): Promise<{ agentId: string }> {
  const apiKey = getRetellApiKey();

  const body: Record<string, unknown> = {
    response_engine: { type: "retell-llm", llm_id: params.llmId },
    voice_id:        resolveRetellVoiceId(params.voiceId),
    agent_name:      params.agentName,
    language:        params.language ?? "en-GB",
  };
  if (params.webhookUrl) body.webhook_url = params.webhookUrl;

  const data = await withRetry(
    async () => {
      const res = await fetch(`${RETELL_BASE_URL}/create-agent`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          `Retell API error creating agent: HTTP ${res.status} — ${errBody.message ?? "unknown"}`
        );
      }
      return (await res.json()) as CreateAgentResponse;
    },
    { maxAttempts: 3, baseDelayMs: 500, label: "retellService.createRetellAgent" }
  );

  if (!data.agent_id) throw new Error("Retell create-agent returned no agent_id");
  return { agentId: data.agent_id };
}

/**
 * Updates the system prompt on a Retell LLM (the correct place — the prompt lives
 * on the LLM, not the agent). PATCH /update-retell-llm/{llm_id}. Idempotent.
 */
export async function updateRetellLlmPrompt(llmId: string, generalPrompt: string): Promise<void> {
  const apiKey = getRetellApiKey();

  await withRetry(
    async () => {
      const res = await fetch(`${RETELL_BASE_URL}/update-retell-llm/${llmId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ general_prompt: generalPrompt }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          `Retell API error updating LLM ${llmId}: HTTP ${res.status} — ${errBody.message ?? "unknown"}`
        );
      }
    },
    { maxAttempts: 3, baseDelayMs: 500, label: "retellService.updateRetellLlmPrompt" }
  );
}

/**
 * Fetches a Retell LLM's current general_prompt. GET /get-retell-llm/{llm_id}.
 * Used to verify what prompt an agent is actually running. Returns null on error.
 */
export async function getRetellLlmPrompt(llmId: string): Promise<string | null> {
  const apiKey = getRetellApiKey();
  try {
    const res = await fetch(`${RETELL_BASE_URL}/get-retell-llm/${llmId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { general_prompt?: string };
    return data.general_prompt ?? null;
  } catch {
    return null;
  }
}
