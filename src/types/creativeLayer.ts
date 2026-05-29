// ─── types/creativeLayer.ts ───────────────────────────────────────
// Creative Layer interface — part of the sealed CampaignBlueprint contract.
// Imports from enums only. Never import from other type files.

import { CreativeFormat } from "@/enums/campaignEnums";

export interface CreativeAsset {
  assetId:      string;          // Higgsfield-assigned UUID
  format:       CreativeFormat;
  url:          string;          // CDN URL after generation
  thumbnailUrl: string;
  durationMs?:  number;          // Video assets only
  status:       "pending" | "ready" | "failed";
}

export interface CopyVariant {
  variantId:   string;
  headline:    string;           // Max 40 chars (Meta limit)
  primaryText: string;           // Max 125 chars above "See More"
  description: string;           // Max 30 chars (link description)
  cta:         string;           // e.g. "Get Free Consultation"
}

/**
 * A creative asset uploaded directly by the agency owner (BYO-Creative flow).
 * Stored in Supabase Storage; assetUrl is a 1-year signed URL.
 */
export interface UploadedCreativeAsset {
  assetUrl:   string;          // Supabase signed URL (1-year TTL)
  assetType:  "image" | "video";
  fileName:   string;
  uploadedAt: string;          // ISO timestamp
}

/** Maximum number of uploaded assets per campaign (flat limit — no tiers) */
export const MAX_UPLOADED_ASSETS = 3;

export interface CreativeLayer {
  higgsfieldJobId:  string;
  serviceContext:   string;      // Passed to Higgsfield as generation prompt
  visualStyle:      string;      // e.g. "professional, trust-building, urgent"
  brandColors:      string[];    // Hex array
  assets:           CreativeAsset[];
  copyVariants:     CopyVariant[];
  primaryAssetId:   string;      // Which asset goes into the primary ad
  generatedAt?:     string;      // ISO timestamp

  /**
   * Creative mode — set once at campaign setup, cannot be changed after launch.
   * 'generate' → Higgsfield flow (default)
   * 'upload'   → BYO-Creative flow (agency uploads client's own assets)
   */
  mode?:            "generate" | "upload";

  /**
   * Uploaded assets (BYO-Creative flow only).
   * Max MAX_UPLOADED_ASSETS assets per campaign.
   */
  uploadedAssets?:  UploadedCreativeAsset[];
}
