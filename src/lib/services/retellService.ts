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
