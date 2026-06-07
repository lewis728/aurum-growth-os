-- Routing + per-contractor calendar (demand-arbitrage build).
-- Additive columns on Contractor for city/vertical routing + backup ordering,
-- and CalendarConnection becomes per-contractor (tenantId no longer unique).

-- Contractor: company name, vertical, routing priority
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "vertical" TEXT NOT NULL DEFAULT 'roofing';
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Contractor_city_vertical_status_idx" ON "Contractor"("city", "vertical", "status");

-- CalendarConnection: per-contractor ownership. One tenant (Lewis) owns many
-- contractor calendars, so tenantId can no longer be unique.
ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "contractorId" TEXT;
DROP INDEX IF EXISTS "CalendarConnection_tenantId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_contractorId_key" ON "CalendarConnection"("contractorId");

-- FK (guard against re-run since ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendarConnection_contractorId_fkey'
  ) THEN
    ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_contractorId_fkey"
      FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
