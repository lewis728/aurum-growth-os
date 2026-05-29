// ─── enums/campaignEnums.ts ───────────────────────────────────────
// Sealed enum contract for Aurum Growth OS.
// Do not rename, add, or remove values without updating ALL consumers.

export enum ServiceVertical {
  LAW_PERSONAL_INJURY = "law.personal_injury",
  LAW_FAMILY          = "law.family",
  LAW_CRIMINAL        = "law.criminal",
  AESTHETICS_FILLER   = "aesthetics.anti_wrinkle_filler",
  AESTHETICS_LASER    = "aesthetics.laser_hair_removal",
  DENTAL_IMPLANTS     = "dental.implants",
  DENTAL_WHITENING    = "dental.whitening",
  HVAC_INSTALLATION   = "hvac.installation",
  HVAC_REPAIR         = "hvac.repair",
  ROOFING_RESIDENTIAL = "roofing.residential",
  // Extend per niche onboarding
}

export const VERTICAL_DISPLAY_NAMES: Record<ServiceVertical, string> = {
  [ServiceVertical.LAW_PERSONAL_INJURY]: "Law — Personal Injury",
  [ServiceVertical.LAW_FAMILY]:          "Law — Family",
  [ServiceVertical.LAW_CRIMINAL]:        "Law — Criminal Defence",
  [ServiceVertical.AESTHETICS_FILLER]:   "Aesthetics — Anti-Wrinkle & Fillers",
  [ServiceVertical.AESTHETICS_LASER]:    "Aesthetics — Laser Hair Removal",
  [ServiceVertical.DENTAL_IMPLANTS]:     "Dental — Implants",
  [ServiceVertical.DENTAL_WHITENING]:    "Dental — Whitening",
  [ServiceVertical.HVAC_INSTALLATION]:   "HVAC — Installation",
  [ServiceVertical.HVAC_REPAIR]:         "HVAC — Repair",
  [ServiceVertical.ROOFING_RESIDENTIAL]: "Roofing — Residential",
};

export enum CampaignStatus {
  PENDING    = "pending",
  GENERATING = "generating",
  DEPLOYING  = "deploying",
  LIVE       = "live",
  PAUSED     = "paused",
  FAILED     = "failed",
  ARCHIVED   = "archived",
}

export enum ReminderMessageType {
  CONFIRMATION = "confirmation",
  DAY_BEFORE   = "day_before",
  HOUR_BEFORE  = "hour_before",
}

export enum AdObjective {
  LEAD_GENERATION = "OUTCOME_LEADS",
  CONVERSIONS     = "OUTCOME_SALES",
  AWARENESS       = "OUTCOME_AWARENESS",
}

export enum CreativeFormat {
  VIDEO_PORTRAIT = "video_portrait",  // 9:16 for Reels/Stories
  VIDEO_SQUARE   = "video_square",    // 1:1 for Feed
  IMAGE_STATIC   = "image_static",
  CAROUSEL       = "carousel",
}

export enum LeadFormFieldEnum {
  FULL_NAME   = "full_name",
  EMAIL       = "email",
  PHONE       = "phone",
  POSTCODE    = "postcode",
  MESSAGE     = "message",
  CASE_TYPE   = "case_type",    // Law verticals
  INJURY_DATE = "injury_date",  // Personal Injury
}

export enum WebhookEvent {
  LEAD_CREATED       = "lead.created",
  LEAD_QUALIFIED     = "lead.qualified",
  CALL_COMPLETED     = "call.completed",
  APPOINTMENT_BOOKED = "appointment.booked",
}
