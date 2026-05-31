// ─── types/voiceLayer.ts ──────────────────────────────────────────
// Voice AI Layer interface — part of the sealed CampaignBlueprint contract.
// No imports from other type files. Pure TypeScript.

export interface PromptInjections {
  serviceName:             string;    // "Personal Injury Law"
  serviceCategory:         string;    // "Law"
  keyPainPoints:           string[];  // For empathy framing
  valuePropositions:       string[];  // What the client offers
  qualificationQuestions:  string[];  // Bot asks these to qualify lead
  bookingCta:              string;    // "Let me schedule a free consultation for you"
  complianceNotes:         string;    // e.g. "Do not guarantee outcomes"
  tenantName:              string;    // Firm/clinic name
  tenantPhone?:            string;    // Transfer number if needed
}

export interface CallAnalysis {
  callId:            string;
  durationMs:        number;
  transcript:        string;
  summary:           string;
  appointmentBooked: boolean;
  qualifiedLead:     boolean;
  sentiment:         "positive" | "neutral" | "negative";
  customData?:       Record<string, unknown>;
}

export interface VoiceLayer {
  retellAgentId:        string;
  retellLlmId?:         string;   // Retell LLM that holds the general_prompt (set on provisioning)
  retellPhoneNumberId:  string;
  basePromptTemplateId: string;   // Which base template to use
  promptInjections:     PromptInjections;
  assembledPrompt?:     string;   // Populated by retellPromptAssembler.ts
  postCallWebhookUrl:   string;   // Retell sends call summary here
  maxCallDurationSec:   number;   // Safety cutoff, e.g. 600
  voiceId:              string;   // Retell voice asset ID
  language:             string;   // "en-US"
}
