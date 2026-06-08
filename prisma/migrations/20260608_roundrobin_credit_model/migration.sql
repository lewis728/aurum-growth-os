-- Round-robin + prepaid-block credit model (£1,200 = 3 bookings, auto-recharge).
-- Contractor pricing defaults change to £400/booking, £1,200 lock-in; add the
-- round-robin pointer. Lead gains the contractor assigned at call placement.

ALTER TABLE "Contractor" ALTER COLUMN "pricePerSurveyGbp" SET DEFAULT 400;
ALTER TABLE "Contractor" ALTER COLUMN "lockInFeeGbp" SET DEFAULT 1200;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "lastAssignedAt" TIMESTAMP(3);

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "assignedContractorId" TEXT;
