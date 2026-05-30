-- AlterTable: client contact + WhatsApp number for monthly update messages
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "clientContactName" TEXT;
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "clientWhatsApp"     TEXT;
