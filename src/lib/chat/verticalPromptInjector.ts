/**
 * src/lib/chat/verticalPromptInjector.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Fetches live vertical intelligence from the VerticalProfile library and
 * maps it into the SystemPromptContext.verticalKnowledge shape.
 *
 * Never throws — returns an empty object on any failure so the system prompt
 * degrades gracefully rather than blocking the chat response.
 */

import { getVerticalProfile } from "@/lib/services/verticalLibraryService";
import { ServiceVertical } from "@/enums/campaignEnums";
import type { SystemPromptContext } from "@/types/systemPromptContext";

/**
 * Fetches the VerticalProfile for the given vertical and maps it into
 * the Partial<SystemPromptContext> shape expected by buildSystemPrompt().
 *
 * @param tenantId  - Clerk organisation ID (used for logging only)
 * @param vertical  - The ServiceVertical enum value to look up
 * @returns Partial<SystemPromptContext> with verticalKnowledge populated,
 *          or an empty object if no profile is found or an error occurs.
 */
export async function injectVerticalKnowledge(
  tenantId: string,
  vertical: ServiceVertical
): Promise<Partial<SystemPromptContext>> {
  try {
    const profile = await getVerticalProfile(vertical);

    if (!profile) {
      console.info(
        `[verticalPromptInjector] No profile found for vertical=${String(vertical)}, tenantId=${tenantId}. Skipping injection.`
      );
      return {};
    }

    return {
      verticalKnowledge: {
        cplBenchmarkGbp: profile.cplBenchmarkGbp,
        creativeStyle: profile.creativeStyle,
        bidStrategyNotes: profile.bidStrategyNotes,
        audienceNotes: profile.audienceNotes,
      },
    };
  } catch (err) {
    // Non-fatal — the system prompt will render without vertical intelligence
    console.warn(
      `[verticalPromptInjector] Failed to inject vertical knowledge for ` +
      `vertical=${String(vertical)}, tenantId=${tenantId}:`,
      err
    );
    return {};
  }
}
