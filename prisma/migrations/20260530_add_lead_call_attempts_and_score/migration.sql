-- AlterTable: speed-to-lead retry tracking + intent scoring on Lead
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "callAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "leadScore"    INTEGER;
