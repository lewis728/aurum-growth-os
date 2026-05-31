-- Schema drift fix: MonthlyReport.generatedAt (NOT NULL, default now()).
ALTER TABLE "MonthlyReport" ADD COLUMN IF NOT EXISTS "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
