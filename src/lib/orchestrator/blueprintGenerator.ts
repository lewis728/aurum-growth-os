/**
 * src/lib/orchestrator/blueprintGenerator.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Builds a complete CampaignBlueprint from a BusinessProfile captured during
 * the onboarding conversation. Calls verticalMatcher to classify the business,
 * then populates all five blueprint layers with sensible defaults derived from
 * the vertical and the profile answers.
 *
 * The returned blueprint is NOT saved to the database — the caller (onboarding
 * chat route) persists it after confirmation.
 *
 * Currency conversion: GBP → USD at a fixed rate stored in config.
 * Update GBP_TO_USD_RATE when the rate drifts significantly.
 */

import { matchVertical } from "@/lib/orchestrator/verticalMatcher";
import { getOrGenerateVerticalProfile } from "@/lib/services/verticalLibraryService";
import {
  ServiceVertical,
  CampaignStatus,
  AdObjective,
  CreativeFormat,
  LeadFormFieldEnum,
  WebhookEvent,
} from "@/enums/campaignEnums";
import type { CampaignBlueprint } from "@/types/campaignBlueprint";
import type { CreativeLayer } from "@/types/creativeLayer";
import type { MediaBuyingLayer } from "@/types/mediaBuyingLayer";
import type { DeploymentLayer } from "@/types/deploymentLayer";
import type { VoiceLayer } from "@/types/voiceLayer";
import type { CRMLayer } from "@/types/crmLayer";

// ── Config ────────────────────────────────────────────────────────────────────

/** GBP to USD conversion rate. Update when rate drifts significantly. */
const GBP_TO_USD_RATE = 1.27;

// ── BusinessProfile ───────────────────────────────────────────────────────────

/**
 * Structured profile extracted from the onboarding conversation.
 * All fields are required — onboardingEngine ensures completeness before calling.
 */
export interface BusinessProfile {
  /** Client's business name (extracted or inferred from Q1 answer) */
  businessName: string;
  /** Free-text description of the business type (e.g. "dental practice in Manchester") */
  businessType: string;
  /** Who the client serves (e.g. "adults 25-55 in Manchester") */
  targetCustomer: string;
  /** Client's unique selling point / differentiator from Q3 */
  uniqueSellingPoint: string;
  /** How new customers typically convert */
  conversionGoal: "walkin" | "phonecall" | "formbooking";
  /** Name the AI representative will use on calls (from Q4) */
  repName: string;
  /** Daily advertising budget in GBP (from Q5) */
  dailyBudgetGbp: number;
  /** Geographic targeting — city, region, or country (extracted from Q1 or Q2) */
  geography: string;
}

// ── Vertical Intelligence ─────────────────────────────────────────────────────

interface VerticalDefaults {
  creativeStyle: string;
  visualStyle: string;
  brandColors: string[];
  ageMin: number;
  ageMax: number;
  placements: string[];
  formFields: LeadFormFieldEnum[];
  templateId: string;
  slaMinutes: number;
  maxCallDurationSec: number;
  voiceId: string;
  language: string;
  qualificationQuestions: string[];
  bookingCta: string;
  complianceNotes: string;
}

/**
 * Per-vertical defaults derived from Aurum's media buying principles.
 * These are the same defaults the aesthetics agent uses — consistent across niches.
 */
function getVerticalDefaults(vertical: ServiceVertical): VerticalDefaults {
  const base: VerticalDefaults = {
    creativeStyle: "professional, trust-building, results-focused",
    visualStyle: "clean, modern, aspirational",
    brandColors: ["#C9A84C", "#FFFFFF", "#1A1A1A"],
    ageMin: 25,
    ageMax: 65,
    placements: ["facebook_feed", "instagram_feed", "instagram_reels", "facebook_stories"],
    formFields: [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE, LeadFormFieldEnum.EMAIL],
    templateId: "lp-general-v1",
    slaMinutes: 1,
    maxCallDurationSec: 600,
    voiceId: "11labs-adriana",
    language: "en-GB",
    qualificationQuestions: [
      "Are you looking for help right now, or just exploring your options?",
      "Have you looked into this before, or is this your first time?",
    ],
    bookingCta: "Let me schedule a free consultation for you",
    complianceNotes: "Do not guarantee specific outcomes. Always recommend professional consultation.",
  };

  switch (vertical) {
    case ServiceVertical.AESTHETICS_FILLER:
    case ServiceVertical.AESTHETICS_LASER:
      return {
        ...base,
        creativeStyle: "aspirational, before-after, confidence-building",
        visualStyle: "clean, clinical, premium, warm lighting",
        brandColors: ["#C9A84C", "#F5F0EB", "#2C2C2C"],
        ageMin: 25,
        ageMax: 55,
        genders: [2], // Female-skewed
        formFields: [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE, LeadFormFieldEnum.EMAIL, LeadFormFieldEnum.POSTCODE],
        templateId: "lp-aesthetics-v1",
        qualificationQuestions: [
          "Have you had any aesthetic treatments before?",
          "Are you looking for a specific treatment, or would you like a consultation first?",
          "Is there a particular area you'd like to focus on?",
        ],
        bookingCta: "Let me book you a free consultation with the clinic",
        complianceNotes:
          "Do not guarantee specific results. Mention that a consultation is required before any treatment. Do not discuss pricing — direct to clinic.",
      } as VerticalDefaults & { genders: number[] };

    case ServiceVertical.DENTAL_IMPLANTS:
    case ServiceVertical.DENTAL_WHITENING:
      return {
        ...base,
        creativeStyle: "smile transformation, confidence, professional",
        visualStyle: "bright, clean, clinical, before-after",
        brandColors: ["#0066CC", "#FFFFFF", "#F0F8FF"],
        ageMin: 30,
        ageMax: 65,
        formFields: [LeadFormFieldEnum.FULL_NAME, LeadFormFieldEnum.PHONE, LeadFormFieldEnum.EMAIL],
        templateId: "lp-dental-v1",
        qualificationQuestions: [
          "Are you looking to improve the appearance of your smile, or do you have a specific dental concern?",
          "Have you had a consultation with a dentist about this before?",
          "Are you based locally or willing to travel for the right clinic?",
        ],
        bookingCta: "Let me arrange a free smile assessment for you",
        complianceNotes:
          "Do not diagnose or recommend specific treatments. Always recommend an in-person consultation. Do not discuss pricing.",
      };

    case ServiceVertical.LAW_PERSONAL_INJURY:
    case ServiceVertical.LAW_FAMILY:
    case ServiceVertical.LAW_CRIMINAL:
      return {
        ...base,
        creativeStyle: "empathetic, authoritative, results-driven",
        visualStyle: "professional, trustworthy, serious",
        brandColors: ["#1A3A5C", "#C9A84C", "#FFFFFF"],
        ageMin: 25,
        ageMax: 65,
        formFields: [
          LeadFormFieldEnum.FULL_NAME,
          LeadFormFieldEnum.PHONE,
          LeadFormFieldEnum.EMAIL,
          LeadFormFieldEnum.CASE_TYPE,
        ],
        templateId: "lp-law-v2",
        slaMinutes: 2,
        qualificationQuestions: [
          "Can you tell me a little about your situation?",
          "When did this happen, roughly?",
          "Have you spoken to a solicitor about this before?",
        ],
        bookingCta: "Let me arrange a free case review with one of our solicitors",
        complianceNotes:
          "Do not provide legal advice. Do not comment on the merits of a case. Always recommend speaking with a qualified solicitor.",
      };

    case ServiceVertical.HVAC_INSTALLATION:
    case ServiceVertical.HVAC_REPAIR:
    case ServiceVertical.ROOFING_RESIDENTIAL:
      return {
        ...base,
        creativeStyle: "urgent, reliable, local, professional",
        visualStyle: "practical, trustworthy, before-after",
        brandColors: ["#1E4D8C", "#F5A623", "#FFFFFF"],
        ageMin: 30,
        ageMax: 65,
        formFields: [
          LeadFormFieldEnum.FULL_NAME,
          LeadFormFieldEnum.PHONE,
          LeadFormFieldEnum.POSTCODE,
        ],
        templateId: "lp-trades-v1",
        slaMinutes: 1,
        qualificationQuestions: [
          "Is this an urgent repair or are you planning ahead?",
          "Are you a homeowner or renting?",
          "Roughly what area are you in?",
        ],
        bookingCta: "Let me get someone to call you back within the hour",
        complianceNotes: "Do not quote prices. Direct all pricing questions to the office.",
      };

    default:
      return base;
  }
}

// ── Layer Builders ────────────────────────────────────────────────────────────

function buildCreativeLayer(
  profile: BusinessProfile,
  defaults: VerticalDefaults
): CreativeLayer {
  return {
    higgsfieldJobId: "",                  // Populated when Higgsfield job is queued
    serviceContext:
      `${profile.businessName} — ${profile.businessType}. ` +
      `Target: ${profile.targetCustomer}. USP: ${profile.uniqueSellingPoint}.`,
    visualStyle: defaults.visualStyle,
    brandColors: defaults.brandColors,
    assets: [],                           // Populated after Higgsfield generation
    copyVariants: [],                     // Populated after copy generation
    primaryAssetId: "",                   // Set after assets are generated
  };
}

function buildMediaBuyingLayer(
  profile: BusinessProfile,
  defaults: VerticalDefaults,
  dailyBudgetUsd: number
): MediaBuyingLayer {
  return {
    adAccountId: "",                      // Populated from MetaConnection at launch
    pixelId: "",                          // Populated from MetaConnection at launch
    objective: AdObjective.LEAD_GENERATION,
    dailyBudgetUsd,
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: {
      geoLocations: {
        countries: profile.geography.toLowerCase().includes("uk") ||
                   profile.geography.toLowerCase().includes("united kingdom")
          ? ["GB"]
          : undefined,
        cities: [],
        radiusKm: 25,
      },
      ageMin: defaults.ageMin,
      ageMax: defaults.ageMax,
      interests: [],
    },
    placements: defaults.placements,
    landingPageUrl: "",                   // Populated after DeploymentLayer runs
    utmParams: {
      source: "meta",
      medium: "paid_social",
      campaign: "",                       // Populated with blueprintId at launch
      content: "",                        // Populated with adId at launch
    },
  };
}

function buildDeploymentLayer(
  profile: BusinessProfile,
  defaults: VerticalDefaults
): DeploymentLayer {
  // Generate a URL-safe subdomain from the business name
  const subdomain = profile.businessName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20) || "client";

  return {
    templateId: defaults.templateId,
    tenantSubdomain: subdomain,
    copy: {
      heroHeadline: `${profile.uniqueSellingPoint}`,
      heroSubheadline: `Serving ${profile.geography} — Book your free consultation today`,
      bodyParagraph:
        `At ${profile.businessName}, we specialise in helping ${profile.targetCustomer}. ` +
        `${profile.uniqueSellingPoint}. Book your free consultation and find out how we can help you.`,
      socialProof: "Trusted by hundreds of clients across the UK",
      formHeading: "Get Your Free Consultation",
      urgencyBadge: "Limited availability this week",
      footerDisclaimer:
        `© ${new Date().getFullYear()} ${profile.businessName}. All rights reserved.`,
    },
    heroAssetUrl: "",                     // Populated after CreativeLayer generation
    formFields: defaults.formFields,
    webhookEndpoint: `/api/webhooks/leads/`,  // blueprintId appended at launch
    privacyPolicyUrl: `https://aurumgo.com/privacy`,
  };
}

function buildVoiceLayer(
  profile: BusinessProfile,
  defaults: VerticalDefaults
): VoiceLayer {
  return {
    retellAgentId: "",                    // Populated after Retell agent creation
    retellPhoneNumberId: "",              // Populated after Retell number assignment
    basePromptTemplateId: `template-${defaults.templateId}`,
    promptInjections: {
      serviceName: profile.businessType,
      serviceCategory: profile.businessType.split(" ")[0] ?? "Service",
      keyPainPoints: [
        `Struggling to find a reliable ${profile.businessType.split(" ")[0] ?? "service"} provider`,
        "Unsure where to start",
        "Looking for a trusted local expert",
      ],
      valuePropositions: [profile.uniqueSellingPoint],
      qualificationQuestions: defaults.qualificationQuestions,
      bookingCta: defaults.bookingCta,
      complianceNotes: defaults.complianceNotes,
      tenantName: profile.businessName,
    },
    postCallWebhookUrl: `/api/webhooks/calls/`,  // blueprintId appended at launch
    maxCallDurationSec: defaults.maxCallDurationSec,
    voiceId: defaults.voiceId,
    language: defaults.language,
    repName: profile.repName,
  } as unknown as VoiceLayer;
}

function buildCRMLayer(profile: BusinessProfile, defaults: VerticalDefaults): CRMLayer {
  return {
    inboundWebhookPath: `/api/webhooks/leads/`,  // blueprintId appended at launch
    intentTag: `${profile.businessType.toLowerCase().replace(/\s+/g, "_")}`,
    leadSchema: {
      requiredFields: defaults.formFields,
      enrichmentFields: ["ip", "userAgent", "utmSource", "utmCampaign", "utmContent"],
    },
    automationTriggers: [
      {
        event: WebhookEvent.LEAD_CREATED,
        automationId: "speed-to-lead-sms",
        delaySeconds: 0,
        conditions: {},
      },
      {
        event: WebhookEvent.CALL_COMPLETED,
        automationId: "post-call-follow-up",
        delaySeconds: 300,
        conditions: { qualifiedLead: true },
      },
      {
        event: WebhookEvent.APPOINTMENT_BOOKED,
        automationId: "appointment-confirmation-sms",
        delaySeconds: 0,
        conditions: {},
      },
    ],
    crmIntegrationId: "",                 // Populated from CRM connection at launch
    notificationEmails: [],               // Populated from tenant profile at launch
    slaMinutes: defaults.slaMinutes,
  };
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Generates a complete CampaignBlueprint from a BusinessProfile.
 *
 * Steps:
 *   1. Match business type to ServiceVertical via GPT-4o-mini
 *   2. Load vertical defaults (benchmark CPL, creative style, targeting)
 *   3. Build all five blueprint layers
 *   4. Convert daily budget from GBP to USD
 *   5. Return populated blueprint (NOT saved to DB)
 *
 * @param profile - Structured profile from onboarding conversation
 * @param tenantId - Clerk organisation ID
 * @returns Partial<CampaignBlueprint> ready for DB persistence
 */
export async function generateBlueprintFromProfile(
  profile: BusinessProfile,
  tenantId: string
): Promise<Partial<CampaignBlueprint>> {
  // ── 1. Vertical matching ──────────────────────────────────────────────────────────────────────────────────
  const vertical = await matchVertical(profile.businessType);

  // ── 2. Load vertical defaults + library intelligence in parallel ─────────────────────────────────────────────────────────────────────────────────
  // getVerticalDefaults() provides structural defaults (form fields, placements, etc.)
  // getOrGenerateVerticalProfile() provides live intelligence (CPL, creative style, targeting)
  const [defaults, verticalProfile] = await Promise.all([
    Promise.resolve(getVerticalDefaults(vertical)),
    getOrGenerateVerticalProfile(vertical, profile.businessType),
  ]);

  // ── Merge library intelligence into defaults where available ─────────────
  // Library values take precedence over hardcoded defaults for intelligence fields.
  const mergedDefaults: VerticalDefaults = {
    ...defaults,
    creativeStyle: verticalProfile.creativeStyle || defaults.creativeStyle,
    qualificationQuestions: defaults.qualificationQuestions, // Structural — keep defaults
    bookingCta: defaults.bookingCta,                         // Structural — keep defaults
    complianceNotes: defaults.complianceNotes,               // Structural — keep defaults
  };

  // ── Attach library intelligence to mediaBuying for CPL/bid strategy ──────
  const libraryIntelligence = {
    cplBenchmarkGbp: verticalProfile.cplBenchmarkGbp,
    cplBenchmarkUsd: verticalProfile.cplBenchmarkUsd,
    targetingRecommendations: verticalProfile.targetingRecommendations,
    bidStrategyNotes: verticalProfile.bidStrategyNotes,
    offerStructure: verticalProfile.offerStructure,
    callScriptNotes: verticalProfile.callScriptNotes,
    avgTransactionValueGbp: verticalProfile.avgTransactionValueGbp,
    purchaseTimelineDays: verticalProfile.purchaseTimelineDays,
  };

  // ── 3. Currency conversion ────────────────────────────────────────────────────────────────────────────────
  const dailyBudgetUsd = Math.round(profile.dailyBudgetGbp * GBP_TO_USD_RATE * 100) / 100;
  const monthlyCapUsd = Math.round(dailyBudgetUsd * 30.5 * 100) / 100;

  // ── 4. Build all five layers ──────────────────────────────────────────────────────────────────────────────────
  const creativeLayer = buildCreativeLayer(profile, mergedDefaults);
  const mediaBuyingLayer = buildMediaBuyingLayer(profile, mergedDefaults, dailyBudgetUsd);
  const deploymentLayer = buildDeploymentLayer(profile, mergedDefaults);
  const voiceLayer = buildVoiceLayer(profile, mergedDefaults);
  const crmLayer = buildCRMLayer(profile, mergedDefaults);

  // ── Attach library intelligence to mediaBuyingLayer for CPL tracking ─────
  (mediaBuyingLayer as MediaBuyingLayer & { libraryIntelligence: typeof libraryIntelligence })
    .libraryIntelligence = libraryIntelligence;

  // ── 5. Assemble blueprint ─────────────────────────────────────────────────
  const now = new Date().toISOString();

  const blueprint: Partial<CampaignBlueprint> = {
    tenantId,
    serviceIntent: vertical,
    status: CampaignStatus.PENDING,
    budget: {
      dailyUsd: dailyBudgetUsd,
      monthlyCapUsd,
      stripeMandateId: "",              // Populated after Stripe authorisation
      billingCycleStart: now.split("T")[0]!,
    },
    creativeLayer,
    mediaBuyingLayer,
    deploymentLayer,
    voiceLayer,
    crmLayer,
    orchestrationLog: [],
    createdAt: now,
    updatedAt: now,
  };

  console.log(
    `[blueprintGenerator] Generated blueprint for tenant ${tenantId}: ` +
    `vertical=${vertical}, dailyBudgetUsd=${dailyBudgetUsd}, ` +
    `businessName="${profile.businessName}", repName="${profile.repName}"`
  );

  return blueprint;
}
