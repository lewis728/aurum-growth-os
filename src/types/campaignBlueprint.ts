// ─── types/campaignBlueprint.ts ──────────────────────────────────
// SEALED CONTRACT. Do not modify without updating ALL downstream consumers.
// This is the single source of truth that flows through the entire pipeline.

import { ServiceVertical, CampaignStatus } from "@/enums/campaignEnums";
import type { CreativeLayer }    from "@/types/creativeLayer";
import type { MediaBuyingLayer } from "@/types/mediaBuyingLayer";
import type { DeploymentLayer }  from "@/types/deploymentLayer";
import type { VoiceLayer }       from "@/types/voiceLayer";
import type { CRMLayer }         from "@/types/crmLayer";

export interface OrchestratorEvent {
  step:       string;                        // e.g. "CREATIVE_GENERATED"
  status:     "success" | "failure" | "skipped";
  timestamp:  string;                        // ISO timestamp
  durationMs: number;
  error?:     string;
  payload?:   Record<string, unknown>;
}

export interface CampaignBlueprint {
  // ── Identity ──────────────────────────────────────────────────
  blueprintId:   string;                     // CUID or UUID v4
  tenantId:      string;
  serviceIntent: ServiceVertical;
  status:        CampaignStatus;

  // ── Budget Guard (validated against Stripe before orchestration) ─
  budget: {
    dailyUsd:          number;
    monthlyCapUsd:     number;               // Computed: dailyUsd * 30.5
    stripeMandateId:   string;               // Authorisation token from Stripe
    billingCycleStart: string;               // ISO date
  };

  // ── The Five Layers ───────────────────────────────────────────
  creativeLayer:    CreativeLayer;
  mediaBuyingLayer: MediaBuyingLayer;
  deploymentLayer:  DeploymentLayer;
  voiceLayer:       VoiceLayer;
  crmLayer:         CRMLayer;

  // ── Audit Trail ───────────────────────────────────────────────
  orchestrationLog: OrchestratorEvent[];
  createdAt:        string;                  // ISO timestamp
  updatedAt:        string;                  // ISO timestamp
  liveAt?:          string;                  // ISO timestamp when status -> "live"
}

// BlueprintLead — lightweight projection used in UI and webhook handlers
export interface BlueprintLead {
  id:          string;
  blueprintId: string;
  tenantId:    string;
  firstName:   string;
  lastName:    string;
  phone:       string;
  email?:      string;
  status:      string;
  createdAt:   string;
}
