/**
 * src/lib/services/higgsFieldService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Generates AI creative assets via the Higgsfield API.
 * POST /generate → poll /status/{jobId} with 15×6s timeout.
 * Every external call is wrapped in withRetry() per GR-02.
 */

import { withRetry } from "@/lib/utils/withRetry";
import { CreativeFormat } from "@/enums/campaignEnums";
import type { CreativeAsset } from "@/types/creativeLayer";

const POLL_INTERVAL_MS = 6_000;
const MAX_POLL_ATTEMPTS = 15;

function getHiggsFieldApiKey(): string {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error("HIGGSFIELD_API_KEY is not configured");
  return key;
}

function getHiggsFieldBaseUrl(): string {
  const url = process.env.HIGGSFIELD_API_URL;
  if (!url) throw new Error("HIGGSFIELD_API_URL is not configured");
  return url.replace(/\/$/, "");
}

interface HiggsFieldGenerateResponse {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
}

interface HiggsFieldStatusResponse {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  assetUrl?: string;
  errorMessage?: string;
}

/**
 * Generates a creative asset via Higgsfield.
 * Submits a generation job, then polls /status/{jobId} every 6s for up to 90s.
 * Returns a CreativeAsset with assetUrl populated on success.
 * Throws a descriptive error if the job times out or fails.
 */
export async function generateCreative(
  prompt: string,
  sourceImageUrl?: string
): Promise<CreativeAsset> {
  const apiKey = getHiggsFieldApiKey();
  const baseUrl = getHiggsFieldBaseUrl();

  // ── Step 1: Submit generation job ────────────────────────────────────────
  const generateResponse = await withRetry(
    async () => {
      const body: Record<string, unknown> = { prompt };
      if (sourceImageUrl) body.source_image_url = sourceImageUrl;

      const res = await fetch(`${baseUrl}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(
          `Higgsfield /generate failed: HTTP ${res.status} — ${err.message ?? "unknown error"}`
        );
      }

      return (await res.json()) as HiggsFieldGenerateResponse;
    },
    { maxAttempts: 3, baseDelayMs: 500, label: "higgsFieldService.generateCreative.submit" }
  );

  const { jobId } = generateResponse;

  // ── Step 2: Poll /status/{jobId} until completed or timeout ──────────────
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const statusResponse = await withRetry(
      async () => {
        const res = await fetch(`${baseUrl}/status/${jobId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(
            `Higgsfield /status/${jobId} failed: HTTP ${res.status} — ${err.message ?? "unknown error"}`
          );
        }

        return (await res.json()) as HiggsFieldStatusResponse;
      },
      { maxAttempts: 3, baseDelayMs: 500, label: `higgsFieldService.pollStatus.attempt${attempt}` }
    );

    if (statusResponse.status === "completed") {
      if (!statusResponse.assetUrl) {
        throw new Error(
          `Higgsfield job ${jobId} completed but returned no assetUrl`
        );
      }

      const asset: CreativeAsset = {
        assetId: jobId,
        url: statusResponse.assetUrl,
        thumbnailUrl: statusResponse.assetUrl,
        format: sourceImageUrl ? CreativeFormat.IMAGE_STATIC : CreativeFormat.VIDEO_PORTRAIT,
        status: "ready" as const,
      };

      return asset;
    }

    if (statusResponse.status === "failed") {
      throw new Error(
        `Higgsfield job ${jobId} failed: ${statusResponse.errorMessage ?? "unknown error"}`
      );
    }

    // status is "queued" or "processing" — continue polling
    console.log(
      `[higgsFieldService] Job ${jobId} — status: ${statusResponse.status} (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`
    );
  }

  throw new Error(
    `Higgsfield job ${jobId} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s. ` +
    `Last status: processing. Check Higgsfield dashboard for job status.`
  );
}
