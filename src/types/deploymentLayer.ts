// ─── types/deploymentLayer.ts ─────────────────────────────────────
// Deployment Layer interface — part of the sealed CampaignBlueprint contract.
// Imports from enums only. Never import from other type files.

import { LeadFormFieldEnum } from "@/enums/campaignEnums";

export interface LandingPageCopy {
  heroHeadline:     string;
  heroSubheadline:  string;
  bodyParagraph:    string;
  socialProof:      string;      // e.g. "Trusted by 500+ clients"
  formHeading:      string;      // e.g. "Get Your Free Consultation"
  urgencyBadge?:    string;      // e.g. "Limited spots this week"
  footerDisclaimer: string;
}

export interface DeploymentLayer {
  templateId:          string;   // e.g. "lp-law-v2", "lp-aesthetics-v1"
  tenantSubdomain:     string;   // e.g. "smithlaw" -> smithlaw.aurumgo.com
  customDomain?:       string;   // e.g. "smithlawleads.com"
  copy:                LandingPageCopy;
  heroAssetUrl:        string;   // From CreativeLayer.assets
  formFields:          LeadFormFieldEnum[];
  webhookEndpoint:     string;   // POST endpoint for form submissions
  privacyPolicyUrl:    string;
  deployedUrl?:        string;   // Populated after Vercel deploy
  vercelDeploymentId?: string;
  deployedAt?:         string;   // ISO timestamp
}
