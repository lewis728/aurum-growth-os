-- Schema drift fix: MetaConnection.pageId (NOT NULL, no schema default).
-- Transient '' default makes the add safe even if a row exists, then dropped to
-- match schema.prisma exactly.
ALTER TABLE "MetaConnection" ADD COLUMN IF NOT EXISTS "pageId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MetaConnection" ALTER COLUMN "pageId" DROP DEFAULT;
