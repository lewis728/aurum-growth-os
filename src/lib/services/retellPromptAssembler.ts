/**
 * src/lib/services/retellPromptAssembler.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Assembles the complete voice agent system prompt from a CampaignBlueprint
 * and an optional AIRepresentative configuration.
 *
 * Two paths:
 *   - assembleRetellPrompt / assembleRetellPromptAsync — deterministic assembly.
 *   - assembleVoicePromptFromBrief — GPT-4o writes a human-sounding prompt from
 *     the ClientBrief (preferred for provisioning), with the deterministic path
 *     as a never-fail fallback.
 *
 * ABSOLUTE SECURITY RULES (appended to EVERY prompt, in code — never left to the
 * model):
 *   — Zero vendor names: no "Retell", "OpenAI", "AI company", "technology platform"
 *   — Zero self-identification as AI unless directly asked
 *   — Represents the client business only
 *
 * NEVER THROWS. Returns a safe fallback prompt on any error.
 */

import type { CampaignBlueprint } from "@/types/campaignBlueprint";
import { VERTICAL_DISPLAY_NAMES }  from "@/enums/campaignEnums";
import { prisma }                  from "@/lib/prisma";
import type { AIRepresentative, ClientBrief } from "@prisma/client";
import { RepresentativePersonality } from "@prisma/client";
import OpenAI                      from "openai";
import { renderBriefBlock }        from "@/lib/agents/clientContext";

// Re-export for external callers
export type { AIRepresentative };

// ── Absolute safety rules ───────────────────────────────────────────────────────
// Appended last to EVERY assembled prompt — both the deterministic path and the
// GPT-generated path. Never rely on the model to include these; we add them in code.
function buildAbsoluteRules(businessName: string): string {
  return [
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
}

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

// ── Main assembler (deterministic) ──────────────────────────────────────────────

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
    ].join("\n");

    // ABSOLUTE RULES — always last, non-negotiable
    const absoluteRules = buildAbsoluteRules(businessName);

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

/** Best-effort fetch of vertical call-script notes. Never throws. */
async function fetchVerticalNotes(vertical: string): Promise<string | undefined> {
  try {
    const profile = await prisma.verticalProfile.findUnique({
      where:  { vertical },
      select: { callScriptNotes: true },
    });
    return profile?.callScriptNotes ?? undefined;
  } catch {
    // Non-fatal — proceed without vertical notes
    return undefined;
  }
}

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
  const callScriptNotes = await fetchVerticalNotes(blueprint.serviceIntent as unknown as string);
  return assembleRetellPrompt(blueprint, representative, callScriptNotes);
}

// ── Brief-aware, GPT-generated voice prompt ─────────────────────────────────────

/**
 * Assembles a HUMAN-SOUNDING voice agent prompt from the ClientBrief using GPT-4o.
 *
 * This is what makes the careful onboarding brief actually reach the phone call:
 * ideal customer, bad-lead signals, qualification questions, objection responses,
 * brand tone, key USPs, compliance notes, and average client value are all fed to
 * GPT-4o, which writes a flowing prompt that opens warmly with {{lead_first_name}}
 * / {{business_name}}, weaves qualification into real conversation, handles the
 * specific objections, drives to a concrete booking, and respects compliance.
 *
 * The absolute safety rules are appended in code afterwards — never left to the
 * model. NEVER THROWS: on any GPT/parsing failure it falls back to the
 * deterministic assembler plus the rendered brief block, so provisioning is never
 * blocked by an OpenAI hiccup.
 */
export async function assembleVoicePromptFromBrief(opts: {
  blueprint:      CampaignBlueprint & { businessName?: string; targetLocation?: string };
  representative: AIRepresentative | null;
  brief:          ClientBrief | null;
}): Promise<string> {
  const { blueprint, representative, brief } = opts;

  const businessName = blueprint.businessName ?? "the business";
  const serviceDescription =
    VERTICAL_DISPLAY_NAMES[blueprint.serviceIntent] ?? (blueprint.serviceIntent as unknown as string);
  const repName = representative?.repName ?? "your assistant";
  const tone =
    (brief?.brandTone?.trim()) ||
    (representative?.personality
      ? representative.personality.toLowerCase()
      : "warm and professional");

  const callScriptNotes = await fetchVerticalNotes(blueprint.serviceIntent as unknown as string);

  try {
    // The brief block is the structured fact sheet GPT writes the prompt from.
    const briefFacts = renderBriefBlock(brief);
    const verticalGuidance = callScriptNotes?.trim()
      ? `\n\nVERTICAL GUIDANCE:\n${callScriptNotes.trim()}`
      : "";

    const system =
      "You are an expert conversation designer who writes the system prompt (the " +
      "'general prompt') for outbound phone voice AI agents on a real-time voice " +
      "platform. Your prompts make the agent sound like a warm, competent human on " +
      "the phone — never robotic, never reading a script, never listing questions. " +
      "You output ONLY the finished general prompt text for the agent, with no " +
      "preamble, no markdown, and no explanation.";

    const user =
      `Write the complete general prompt for an outbound caller named ${repName}, ` +
      `who calls on behalf of ${businessName} (a ${serviceDescription} business). ` +
      `${repName} rings a lead within seconds of them submitting an enquiry form.\n\n` +
      `Use these facts about this specific client and how to sell for them:\n` +
      `---\n${briefFacts}${verticalGuidance}\n---\n\n` +
      `The prompt you write MUST direct the agent to:\n` +
      `1. Open warmly and by name, using the placeholders {{lead_first_name}} and ` +
      `{{business_name}} EXACTLY as written (the platform fills them in live) — e.g. ` +
      `"Hi {{lead_first_name}}, it's ${repName} calling from {{business_name}}...".\n` +
      `2. Naturally reference that they just enquired about ${serviceDescription} — ` +
      `never sound like a cold call.\n` +
      `3. Qualify by weaving the qualification questions into genuine back-and-forth ` +
      `conversation — never read them as a list or interrogate.\n` +
      `4. Politely disqualify a lead that matches the bad-lead signals — warm, no hard sell.\n` +
      `5. Reference the key selling points when it helps move toward a booking — ` +
      `naturally, not like an advert.\n` +
      `6. Handle objections using the specific responses provided, in the agent's own ` +
      `warm words.\n` +
      `7. Always drive toward booking a SPECIFIC date and time, and confirm it back ` +
      `clearly. If an average client value is given, let it inform how persistent ` +
      `(but never pushy) the agent is about securing a firm booking.\n` +
      `8. Match this brand tone exactly: ${tone}.\n` +
      `9. NEVER say or claim anything listed under compliance.\n\n` +
      `Write in the second person ("You are ${repName}...", "You should..."). Make it ` +
      `specific to THIS client, flowing and human. Output only the prompt.`;

    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model:       "gpt-4o",
      temperature: 0.6,
      max_tokens:  1400,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user },
      ],
    });
    const generated = completion.choices[0]?.message?.content ?? "";

    if (!generated.trim()) throw new Error("GPT returned an empty prompt");

    // Safety rules are appended in code — never trusted to the model.
    return `${generated.trim()}\n\n${buildAbsoluteRules(businessName)}`;
  } catch (err) {
    console.error("[assembleVoicePromptFromBrief] GPT generation failed, using deterministic fallback:", err);
    const base = assembleRetellPrompt(blueprint, representative, callScriptNotes);
    return `${base}\n\n${renderBriefBlock(brief)}`.trim();
  }
}
