-- Migration: add_agency_profile_and_pending_org_link
-- Adds pendingOrgLink + agency/client answer columns to CampaignBlueprint
-- Adds new AgencyProfile model

-- Add pendingOrgLink and onboarding answer columns to CampaignBlueprint
ALTER TABLE "CampaignBlueprint"
  ADD COLUMN IF NOT EXISTS "pendingOrgLink"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "agencyName"         TEXT,
  ADD COLUMN IF NOT EXISTS "niches"             TEXT,
  ADD COLUMN IF NOT EXISTS "currentClientCount" TEXT,
  ADD COLUMN IF NOT EXISTS "currentFulfilment"  TEXT,
  ADD COLUMN IF NOT EXISTS "primaryGoal"        TEXT,
  ADD COLUMN IF NOT EXISTS "businessDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "monthlyAdBudget"    TEXT,
  ADD COLUMN IF NOT EXISTS "idealLead"          TEXT,
  ADD COLUMN IF NOT EXISTS "desiredOutcome"     TEXT,
  ADD COLUMN IF NOT EXISTS "offerHook"          TEXT;

-- Add index on pendingOrgLink for efficient lookups
CREATE INDEX IF NOT EXISTS "CampaignBlueprint_pendingOrgLink_idx"
  ON "CampaignBlueprint"("pendingOrgLink");

-- Create AgencyProfile table
CREATE TABLE IF NOT EXISTS "AgencyProfile" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "agencyName"         TEXT NOT NULL,
  "niches"             TEXT NOT NULL,
  "currentClientCount" TEXT NOT NULL,
  "currentFulfilment"  TEXT NOT NULL,
  "primaryGoal"        TEXT NOT NULL,
  "onboardedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgencyProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgencyProfile_tenantId_key"
  ON "AgencyProfile"("tenantId");

CREATE INDEX IF NOT EXISTS "AgencyProfile_tenantId_idx"
  ON "AgencyProfile"("tenantId");
