// ─── types/mediaBuyingLayer.ts ────────────────────────────────────
// Media Buying Layer interface — part of the sealed CampaignBlueprint contract.
// Imports from enums only. Never import from other type files.

import { AdObjective } from "@/enums/campaignEnums";

export interface TargetingSpec {
  geoLocations: {
    countries?:       string[];                  // ISO 3166-1 alpha-2
    regions?:         string[];                  // Facebook region IDs
    cities?:          string[];                  // Facebook city IDs
    radiusKm?:        number;                    // For local service businesses
    centerCoord?:     { lat: number; lng: number };
  };
  ageMin:               number;                  // 18–65
  ageMax:               number;
  genders?:             (1 | 2)[];              // 1=male, 2=female
  interests?:           string[];               // Meta interest IDs
  customAudienceIds?:   string[];               // Lookalike / retargeting
  excludedAudienceIds?: string[];
}

export interface MetaAdIds {
  campaignId:   string;
  adSetId:      string;
  adId:         string;
  adCreativeId: string;
}

export interface MediaBuyingLayer {
  adAccountId:     string;                       // act_XXXXXXXXXXXXXXXX
  pixelId:         string;
  objective:       AdObjective;
  dailyBudgetUsd:  number;                       // In dollars; convert to cents for API
  bidStrategy:     "LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "BID_CAP";
  targeting:       TargetingSpec;
  placements:      string[];                     // e.g. ["facebook_feed","instagram_reels"]
  landingPageUrl:  string;                       // Injected after Deployment Layer runs
  utmParams: {
    source:   string;                            // "meta"
    medium:   string;                            // "paid_social"
    campaign: string;                            // blueprintId
    content:  string;                            // adId
  };
  metaAdIds?:      MetaAdIds;                    // Populated after API deployment
  scheduledStart?: string;                       // ISO timestamp, null = immediate
  scheduledEnd?:   string;
}
