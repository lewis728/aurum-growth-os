-- Client Context Engine: deepen the per-client knowledge the agent reasons on.
ALTER TABLE "ClientBrief" ADD COLUMN IF NOT EXISTS "targetCplGbp"    DOUBLE PRECISION;
ALTER TABLE "ClientBrief" ADD COLUMN IF NOT EXISTS "complianceNotes" TEXT;
ALTER TABLE "ClientBrief" ADD COLUMN IF NOT EXISTS "websiteSummary"  TEXT;
