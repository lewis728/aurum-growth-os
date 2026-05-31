-- Schema drift fix: CalendarConnection.calendarId (NOT NULL) + connectedAt
-- (NOT NULL default now()). calendarId has no schema default; a transient ''
-- default makes the add safe even if a row exists, then it's dropped to match
-- schema.prisma exactly.
ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "calendarId"  TEXT NOT NULL DEFAULT '';
ALTER TABLE "CalendarConnection" ALTER COLUMN "calendarId" DROP DEFAULT;
ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
