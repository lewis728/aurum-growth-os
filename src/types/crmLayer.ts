// ─── types/crmLayer.ts ────────────────────────────────────────────
// CRM / Webhook Layer interface — part of the sealed CampaignBlueprint contract.
// Imports from enums only. Never import from other type files.

import { LeadFormFieldEnum, WebhookEvent } from "@/enums/campaignEnums";

export interface AutomationTrigger {
  event:        WebhookEvent;
  automationId: string;                      // Internal automation pipeline ID
  delaySeconds: number;                      // 0 = immediate
  conditions?:  Record<string, unknown>;     // e.g. { "qualified": true }
}

export interface CRMLayer {
  inboundWebhookPath:  string;              // e.g. "/webhooks/leads/{blueprintId}"
  intentTag:           string;              // e.g. "law.personal_injury"
  leadSchema: {
    requiredFields:    LeadFormFieldEnum[];
    enrichmentFields:  string[];            // e.g. ["ip", "userAgent", "utmSource"]
  };
  automationTriggers:  AutomationTrigger[];
  crmIntegrationId:    string;              // Internal CRM integration ID
  notificationEmails:  string[];            // Alert these on new lead
  slaMinutes:          number;              // Speed-to-lead SLA target
}
