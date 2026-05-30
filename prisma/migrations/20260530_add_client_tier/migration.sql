-- AlterTable: per-client billing tier on CampaignBlueprint
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "clientTier" TEXT NOT NULL DEFAULT 'full_service';
