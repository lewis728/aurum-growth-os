-- Schema drift fix: Appointment.source (NOT NULL default 'retell') +
-- calendlyEventId (nullable, unique for Calendly dedup).
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "source"          TEXT NOT NULL DEFAULT 'retell';
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "calendlyEventId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_calendlyEventId_key" ON "Appointment"("calendlyEventId");
CREATE INDEX IF NOT EXISTS "Appointment_calendlyEventId_idx" ON "Appointment"("calendlyEventId");
