-- Schema drift fix: Lead.source (NOT NULL, default 'landing_page').
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'landing_page';
