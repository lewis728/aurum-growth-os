-- AlterTable: morning briefing fields on CampaignBlueprint
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "lastBriefingText" TEXT;
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "lastBriefingAt"   TIMESTAMP(3);

-- AlterTable: Retell speed-to-lead call id on Lead
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "retellCallId" TEXT;
