-- Add all missing columns to VerticalProfile to match the full schema
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "avgTransactionValueGbp" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "purchaseTimelineDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "conversionGoalType" TEXT NOT NULL DEFAULT 'formbooking';
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "cplBenchmarkGbp" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "cplBenchmarkUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "creativeStyle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "audienceNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "targetingRecommendations" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "bidStrategyNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VerticalProfile" ADD COLUMN IF NOT EXISTS "offerStructure" TEXT NOT NULL DEFAULT '';
-- callScriptNotes already exists (nullable)
-- systemPromptBase already added in previous migration
-- Drop sampleSize and createdAt columns that are not in the canonical schema
-- (keep them for now to avoid data loss — they can be cleaned up later)
