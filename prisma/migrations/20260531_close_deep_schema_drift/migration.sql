-- Close deep schema drift between schema.prisma and production.
-- Prod had several columns under legacy names or missing entirely, which made
-- Prisma queries (generated from schema.prisma names) fail at runtime:
--   CalendarConnection.encryptedToken      (prod had accessToken)
--   MetaConnection.encryptedAccessToken    (prod had accessToken)
--   MetaConnection.connectedAt             (absent)
--   AgencySubscription.platformPriceId/seatPriceId (absent, NOT NULL in schema)
--   Appointment.status                     (absent, NOT NULL default 'confirmed')
--
-- All affected tables were empty (0 rows) at apply time, so NOT NULL adds are
-- safe. Renamed columns are added additively and back-filled from the legacy
-- column; legacy columns are intentionally NOT dropped (non-destructive).

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'confirmed';

ALTER TABLE "AgencySubscription" ADD COLUMN IF NOT EXISTS "platformPriceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgencySubscription" ALTER COLUMN "platformPriceId" DROP DEFAULT;
ALTER TABLE "AgencySubscription" ADD COLUMN IF NOT EXISTS "seatPriceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgencySubscription" ALTER COLUMN "seatPriceId" DROP DEFAULT;

ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "encryptedToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CalendarConnection" ALTER COLUMN "encryptedToken" DROP DEFAULT;
UPDATE "CalendarConnection" SET "encryptedToken" = "accessToken"
  WHERE ("encryptedToken" = '' OR "encryptedToken" IS NULL) AND "accessToken" IS NOT NULL;

ALTER TABLE "MetaConnection" ADD COLUMN IF NOT EXISTS "encryptedAccessToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MetaConnection" ALTER COLUMN "encryptedAccessToken" DROP DEFAULT;
UPDATE "MetaConnection" SET "encryptedAccessToken" = "accessToken"
  WHERE ("encryptedAccessToken" = '' OR "encryptedAccessToken" IS NULL) AND "accessToken" IS NOT NULL;
ALTER TABLE "MetaConnection" ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
