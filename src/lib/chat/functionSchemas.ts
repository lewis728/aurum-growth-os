/**
 * src/lib/chat/functionSchemas.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Defines the OpenAI function calling tool schema for the Aurum Growth OS
 * chat interface. The LLM calls LAUNCH_FUNNEL_TOOL once — and only once —
 * per confirmed campaign intent.
 *
 * The chat API route validates the extracted arguments against
 * validateLaunchArgs() before passing them to funnelOrchestrator().
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ─── LAUNCH_FUNNEL_TOOL ───────────────────────────────────────────────────────

/**
 * The exact JSON schema passed to the LLM API as a tool definition.
 * The LLM calls this function once — and only once — per confirmed campaign intent.
 */
export const LAUNCH_FUNNEL_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "launch_funnel_blueprint",
    description:
      "Launch a complete 5-layer revenue funnel for a given service vertical. " +
      "Call this function ONLY after the user has explicitly confirmed the campaign details " +
      "and said 'yes, launch it' or equivalent confirmation. " +
      "Do NOT call this function to gather information or during the clarification phase.",
    parameters: {
      type: "object",
      properties: {
        serviceVertical: {
          type: "string",
          enum: [
            "law.personal_injury",
            "law.family",
            "law.criminal",
            "aesthetics.anti_wrinkle_filler",
            "aesthetics.laser_hair_removal",
            "dental.implants",
            "dental.whitening",
            "hvac.installation",
            "hvac.repair",
            "roofing.residential",
          ],
          description:
            "The service vertical for this campaign. Must be one of the supported enum values.",
        },
        dailyBudgetUsd: {
          type: "number",
          minimum: 10,
          description:
            "Daily advertising budget in USD. Minimum $10/day. " +
            "Confirm this value explicitly with the client before calling this function.",
        },
        campaignName: {
          type: "string",
          minLength: 3,
          maxLength: 80,
          description:
            "Human-readable display name for this campaign. " +
            "Should be descriptive and unique within the tenant account.",
        },
        targetLocation: {
          type: "string",
          minLength: 2,
          maxLength: 100,
          description:
            "Geographic targeting for this campaign. " +
            "Can be a city, region, county, or country. " +
            "Examples: 'London', 'Manchester', 'United Kingdom', 'Greater London'.",
        },
        offerDescription: {
          type: "string",
          minLength: 10,
          maxLength: 500,
          description:
            "The specific offer, hook, or value proposition for this campaign. " +
            "This is used to generate the creative assets and landing page copy. " +
            "Examples: 'Free consultation for personal injury claims', " +
            "'50% off laser hair removal for new clients', " +
            "'Same-day emergency dental appointments available'.",
        },
      },
      required: [
        "serviceVertical",
        "dailyBudgetUsd",
        "campaignName",
        "targetLocation",
        "offerDescription",
      ],
      additionalProperties: false,
    },
  },
};

// ─── VALIDATED LAUNCH ARGS ───────────────────────────────────────────────────

/**
 * The typed shape of arguments extracted from the LLM tool call.
 * These are validated by validateLaunchArgs() before being passed to the orchestrator.
 */
export interface LaunchFunnelArgs {
  serviceVertical:  string;
  dailyBudgetUsd:   number;
  campaignName:     string;
  targetLocation:   string;
  offerDescription: string;
}

/** All valid service vertical values — kept in sync with the tool schema above. */
const VALID_VERTICALS = new Set<string>([
  "law.personal_injury",
  "law.family",
  "law.criminal",
  "aesthetics.anti_wrinkle_filler",
  "aesthetics.laser_hair_removal",
  "dental.implants",
  "dental.whitening",
  "hvac.installation",
  "hvac.repair",
  "roofing.residential",
]);

/**
 * Validates the raw arguments extracted from the LLM tool call.
 * Throws a descriptive Error if any field is missing or invalid.
 * This guard runs before any orchestrator or database operation.
 *
 * @param raw - The raw parsed JSON from the tool call arguments
 * @returns Typed LaunchFunnelArgs if all fields are valid
 * @throws Error with a descriptive message if validation fails
 */
export function validateLaunchArgs(raw: unknown): LaunchFunnelArgs {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("validateLaunchArgs: arguments must be a non-null object");
  }

  const args = raw as Record<string, unknown>;

  // serviceVertical
  if (typeof args.serviceVertical !== "string" || args.serviceVertical.trim() === "") {
    throw new Error("validateLaunchArgs: serviceVertical is required and must be a non-empty string");
  }
  if (!VALID_VERTICALS.has(args.serviceVertical)) {
    throw new Error(
      `validateLaunchArgs: serviceVertical "${args.serviceVertical}" is not a valid vertical. ` +
      `Valid values: ${Array.from(VALID_VERTICALS).join(", ")}`
    );
  }

  // dailyBudgetUsd
  if (typeof args.dailyBudgetUsd !== "number" || isNaN(args.dailyBudgetUsd)) {
    throw new Error("validateLaunchArgs: dailyBudgetUsd is required and must be a number");
  }
  if (args.dailyBudgetUsd < 10) {
    throw new Error(
      `validateLaunchArgs: dailyBudgetUsd must be at least $10/day (received: $${args.dailyBudgetUsd})`
    );
  }

  // campaignName
  if (typeof args.campaignName !== "string" || args.campaignName.trim().length < 3) {
    throw new Error("validateLaunchArgs: campaignName is required and must be at least 3 characters");
  }
  if (args.campaignName.length > 80) {
    throw new Error("validateLaunchArgs: campaignName must be 80 characters or fewer");
  }

  // targetLocation
  if (typeof args.targetLocation !== "string" || args.targetLocation.trim().length < 2) {
    throw new Error("validateLaunchArgs: targetLocation is required and must be at least 2 characters");
  }
  if (args.targetLocation.length > 100) {
    throw new Error("validateLaunchArgs: targetLocation must be 100 characters or fewer");
  }

  // offerDescription
  if (typeof args.offerDescription !== "string" || args.offerDescription.trim().length < 10) {
    throw new Error("validateLaunchArgs: offerDescription is required and must be at least 10 characters");
  }
  if (args.offerDescription.length > 500) {
    throw new Error("validateLaunchArgs: offerDescription must be 500 characters or fewer");
  }

  return {
    serviceVertical:  args.serviceVertical.trim(),
    dailyBudgetUsd:   args.dailyBudgetUsd,
    campaignName:     args.campaignName.trim(),
    targetLocation:   args.targetLocation.trim(),
    offerDescription: args.offerDescription.trim(),
  };
}
