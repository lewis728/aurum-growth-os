-- AlterTable: tiered per-seat billing counts on AgencySubscription
-- currentSeatCount is retained for backward compatibility with the flat model.
ALTER TABLE "AgencySubscription" ADD COLUMN IF NOT EXISTS "starterSeatCount"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgencySubscription" ADD COLUMN IF NOT EXISTS "fullServiceSeatCount" INTEGER NOT NULL DEFAULT 0;
