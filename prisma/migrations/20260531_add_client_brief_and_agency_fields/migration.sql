-- Build 1: Dual Agent Architecture
-- ClientBrief (per-client account-manager brief) + AgencyProfile chief-of-staff
-- fields + portfolio-level (null blueprintId) AgentActions.

-- ── ClientBrief ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ClientBrief" (
  "id"                     TEXT NOT NULL,
  "blueprintId"            TEXT NOT NULL,
  "tenantId"               TEXT NOT NULL,
  "idealCustomerProfile"   TEXT,
  "badLeadSignals"         TEXT,
  "qualificationQuestions" TEXT,
  "objectionResponses"     JSONB,
  "brandTone"              TEXT,
  "keyUSPs"                TEXT,
  "competitorNames"        TEXT,
  "averageClientValue"     DOUBLE PRECISION,
  "budgetHardLimit"        DOUBLE PRECISION,
  "approvalThreshold"      DOUBLE PRECISION,
  "reportingPreferences"   TEXT,
  "clientContactName"      TEXT,
  "clientContactEmail"     TEXT,
  "clientWhatsApp"         TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientBrief_blueprintId_key" ON "ClientBrief"("blueprintId");
CREATE INDEX IF NOT EXISTS "ClientBrief_tenantId_idx" ON "ClientBrief"("tenantId");

ALTER TABLE "ClientBrief"
  ADD CONSTRAINT "ClientBrief_blueprintId_fkey"
  FOREIGN KEY ("blueprintId") REFERENCES "CampaignBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── AgencyProfile chief-of-staff fields ──────────────────────────────
ALTER TABLE "AgencyProfile" ADD COLUMN IF NOT EXISTS "slackWebhookUrl"          TEXT;
ALTER TABLE "AgencyProfile" ADD COLUMN IF NOT EXISTS "agencyAverageClientValue" DOUBLE PRECISION;
ALTER TABLE "AgencyProfile" ADD COLUMN IF NOT EXISTS "targetClientsPerMonth"    INTEGER;
ALTER TABLE "AgencyProfile" ADD COLUMN IF NOT EXISTS "chiefOfStaffBrief"        TEXT;

-- ── AgentAction: portfolio-level actions (nullable blueprintId) ──────
ALTER TABLE "AgentAction" ALTER COLUMN "blueprintId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "AgentAction_tenantId_executedAt_idx" ON "AgentAction"("tenantId", "executedAt");
