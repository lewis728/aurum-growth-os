/**
 * src/lib/services/retellPromptAssembler.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * FULL REWRITE — P2 Step 14.
 * Assembles the complete voice agent system prompt from a CampaignBlueprint
 * and an optional AIRepresentative configuration.
 *
 * ABSOLUTE SECURITY RULES (enforced at the bottom of every assembled prompt):
 *   — Zero vendor names: no "Retell", "OpenAI", "AI company", "technology platform"
 *   — Zero self-identification as AI unless directly asked
 *   — Represents the client business only
 *
 * NEVER THROWS. Returns a safe fallback prompt on any error.
 */

import type { CampaignBlueprint } from "@/types/campaignBlueprint";
import { VERTICAL_DISPLAY_NAMES }  from "@/enums/campaignEnums";
import { prisma }                  from "@/lib/prisma";
import type { AIRepresentative }   from "@prisma/client";
import { RepresentativePersonality } from "@prisma/client";

// Re-export for external callers
export type { AIRepresentative };

// ── Personality blocks ────────────────────────────────────────────────────────

function buildPersonalityBlock(personality: RepresentativePersonality): string {
  switch (personality) {
    case RepresentativePersonality.PROFESSIONAL:
      return (
        "You are formal, precise, and authoritative. You speak with confidence and expertise. " +
        "You do not use casual language or filler words. Every sentence serves a purpose."
      );
    case RepresentativePersonality.WARM:
      return (
        "You are empathetic, conversational, and reassuring. You make people feel comfortable. " +
        "You acknowledge their concerns before addressing them. You sound like a trusted advisor."
      );
    case RepresentativePersonality.DIRECT:
      return (
        "You are efficient and outcome-focused. You respect the person's time. " +
        "You get to the point quickly without being abrupt. You ask clear qualifying questions."
      );
    case RepresentativePersonality.CONSULTATIVE:
      return (
        "You are advisory and educational. You ask thoughtful questions before offering solutions. " +
        "You position yourself as an expert who is trying to understand their situation fully."
      );
    default:
      return (
        "You are formal, precise, and authoritative. You speak with confidence and expertise. " +
        "You do not use casual language or filler words. Every sentence serves a purpose."
      );
  }
}

// ── Objection handling ────────────────────────────────────────────────────────

function buildObjectionBlock(
  customObjectionResponses: Record<string, string>,
  callScriptNotes: string
): string {
  const lines: string[] = [];

  if (callScriptNotes.trim()) {
    lines.push("VERTICAL GUIDANCE:");
    lines.push(callScriptNotes.trim());
    lines.push("");
  }

  const customEntries = Object.entries(customObjectionResponses);
  if (customEntries.length > 0) {
    lines.push("OBJECTION HANDLING:");
    for (const [objection, response] of customEntries) {
      lines.push(`  Objection: "${objection}"`);
      lines.push(`  Response:  "${response}"`);
    }
  }

  return lines.join("\n").trim();
}

// ── Main assembler ─────────────────────────────────────────────────────────────

/**
 * Assembles the complete voice agent system prompt.
 *
 * @param blueprint       — The CampaignBlueprint (Prisma row with JSON layers cast to types)
 * @param representative  — Optional AIRepresentative row. If null/undefined, PROFESSIONAL defaults apply.
 * @param callScriptNotes — Optional vertical callScriptNotes from VerticalProfile.
 *
 * NEVER THROWS.
 */
export function assembleRetellPrompt(
  blueprint: CampaignBlueprint & {
    businessName?: string;
    targetLocation?: string;
  },
  representative?: AIRepresentative | null,
  callScriptNotes?: string
): string {
  try {
    const voice      = blueprint.voiceLayer;
    const crm        = blueprint.crmLayer;
    const injections = voice.promptInjections;

    const businessName = blueprint.businessName ?? injections.tenantName ?? "the business";
    const serviceDescription =
      VERTICAL_DISPLAY_NAMES[blueprint.serviceIntent] ??
      injections.serviceName ??
      blueprint.serviceIntent;

    // Representative defaults
    const repName     = representative?.repName     ?? "Your assistant";
    const personality = representative?.personality ?? RepresentativePersonality.PROFESSIONAL;
    const customIntro = representative?.customIntroLine ?? null;
    const customObjectionResponses: Record<string, string> =
      (representative?.customObjectionResponses as Record<string, string> | null) ?? {};

    // IDENTITY BLOCK
    const identityBlock =
      `Your name is ${repName}. You work for ${businessName}. You are calling on behalf of ` +
      `${businessName} to follow up with someone who expressed interest in ${serviceDescription}.`;

    // PERSONALITY BLOCK
    const personalityBlock = buildPersonalityBlock(personality);

    // CUSTOM INTRO
    const introBlock = customIntro
      ? `OPENING LINE:\n${customIntro}`
      : `OPENING LINE:\n"Hi, is this [leadName]? Great — my name is ${repName}, ` +
        `I'm calling from ${businessName} regarding your recent enquiry."`;

    // QUALIFICATION BLOCK
    const qualLines: string[] = ["QUALIFICATION:"];
    if (injections.qualificationQuestions.length > 0) {
      injections.qualificationQuestions.forEach((q, i) => {
        qualLines.push(`  ${i + 1}. ${q} (required)`);
      });
    }
    const requiredFields = crm.leadSchema.requiredFields;
    if (requiredFields.length > 0) {
      qualLines.push("  Collect the following before booking:");
      requiredFields.forEach((f) => qualLines.push(`    — ${f}`));
    }
    const qualificationBlock = qualLines.join("\n");

    // BOOKING BLOCK
    const bookingBlock = [
      "APPOINTMENT BOOKING:",
      `Your primary goal is to book an initial consultation. ${injections.bookingCta}`,
      `SLA: Attempt to book within ${crm.slaMinutes ?? 60} minutes of the lead submitting their details.`,
      "When the prospect is ready:",
      `  1. Confirm interest: "That sounds like a great fit for what we offer at ${businessName}."`,
      `  2. Offer availability: "We have availability this week and next — what works best for you?"`,
      "  3. Collect: full name, best contact number, preferred date and time.",
      `  4. Confirm: "Wonderful, I've got you booked in. You'll receive a confirmation shortly."`,
    ].join("\n");

    // OBJECTION HANDLING
    const objectionBlock = buildObjectionBlock(
      customObjectionResponses,
      callScriptNotes ?? ""
    );

    // CALL CLOSE SCRIPT
    const closeBlock = [
      "CALL CLOSE:",
      "If appointment booked:",
      `  "Brilliant! I'll send you a confirmation message shortly. We look forward to speaking with you. ` +
      `Is there anything else I can help you with today?"`,
      "If not ready to book:",
      `  "No problem at all. I'll make a note of your interest and someone from the team will follow up ` +
      `with more information. Have a wonderful day!"`,
      "If voicemail:",
      `  "Hi, this is a message for [leadName]. I'm calling from ${businessName} regarding your recent ` +
      `enquiry about ${serviceDescription}. Please call us back at your earliest convenience, ` +
      `or we'll try you again shortly. Thank you!"`,
      `  "Is there anything else you'd like to know before we meet? Thank you, and have a great day."`,
    ].join("\n");

    // ABSOLUTE RULES — always last, non-negotiable
    const absoluteRules = [
      "ABSOLUTE RULES — THESE OVERRIDE EVERYTHING ELSE:",
      `You must never reveal that you are an automated system unless directly and specifically asked. ` +
      `If asked, you may say: "I am an automated assistant calling on behalf of ${businessName}."`,
      `You must never mention any technology platform, software company, or service provider. ` +
      `You represent ${businessName} and only ${businessName}.`,
      `Never say the words "Retell", "OpenAI", "AI", "bot", or "system" unless specifically asked ` +
      `whether you are an automated assistant.`,
      "Never make guarantees about outcomes, results, or timelines.",
      `If you do not know the answer to a question, say: ` +
      `"That's a great question — let me have one of our specialists follow up with you on that."`,
    ].join("\n");

    // ASSEMBLE
    const sections = [
      identityBlock,
      personalityBlock,
      introBlock,
      qualificationBlock,
      bookingBlock,
    ];

    if (objectionBlock) sections.push(objectionBlock);

    sections.push(closeBlock);
    sections.push(absoluteRules);

    return sections.join("\n\n").trim();
  } catch (err) {
    // NEVER throws — return a safe fallback
    console.error("[retellPromptAssembler] Error assembling prompt:", err);
    return [
      "You are a professional assistant calling on behalf of the business.",
      "Your goal is to qualify the lead and book an appointment.",
      "Be professional, respectful, and helpful at all times.",
      "ABSOLUTE RULES — THESE OVERRIDE EVERYTHING ELSE:",
      "You must never reveal that you are an automated system unless directly and specifically asked.",
      'Never say the words "Retell", "OpenAI", "AI", "bot", or "system" unless specifically asked.',
    ].join("\n\n");
  }
}

// ── Async variant — fetches VerticalProfile.callScriptNotes automatically ─────

/**
 * Async version of assembleRetellPrompt.
 * Fetches VerticalProfile.callScriptNotes from the database automatically.
 * Falls back to the sync version if the DB fetch fails.
 * NEVER THROWS.
 */
export async function assembleRetellPromptAsync(
  blueprint: CampaignBlueprint & { businessName?: string; targetLocation?: string },
  representative?: AIRepresentative | null
): Promise<string> {
  let callScriptNotes: string | undefined;

  try {
    const profile = await prisma.verticalProfile.findUnique({
      where:  { vertical: blueprint.serviceIntent as string },
      select: { callScriptNotes: true },
    });
    callScriptNotes = profile?.callScriptNotes ?? undefined;
  } catch {
    // Non-fatal — proceed without vertical notes
  }

  return assembleRetellPrompt(blueprint, representative, callScriptNotes);
}
