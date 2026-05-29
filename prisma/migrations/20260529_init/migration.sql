-- Aurum Growth OS — Initial Migration
-- Stage 01: Create all 5 tables with indexes and constraints
-- Generated from prisma/schema.prisma

-- ── CampaignBlueprint ────────────────────────────────────────────────
CREATE TABLE "CampaignBlueprint" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "status"           TEXT NOT NULL,
    "vertical"         TEXT NOT NULL,
    "businessName"     TEXT NOT NULL,
    "targetLocation"   TEXT NOT NULL,
    "dailyBudgetUsd"   DOUBLE PRECISION NOT NULL,
    "creative"         JSONB NOT NULL,
    "mediaBuying"      JSONB NOT NULL,
    "deployment"       JSONB NOT NULL,
    "voice"            JSONB NOT NULL,
    "crm"              JSONB NOT NULL,
    "orchestrationLog" JSONB NOT NULL DEFAULT '[]',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignBlueprint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignBlueprint_tenantId_idx" ON "CampaignBlueprint"("tenantId");
CREATE INDEX "CampaignBlueprint_tenantId_status_idx" ON "CampaignBlueprint"("tenantId", "status");

-- ── Lead ─────────────────────────────────────────────────────────────
CREATE TABLE "Lead" (
    "id"           TEXT NOT NULL,
    "blueprintId"  TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "firstName"    TEXT NOT NULL,
    "lastName"     TEXT NOT NULL,
    "phone"        TEXT NOT NULL,
    "email"        TEXT,
    "status"       TEXT NOT NULL DEFAULT 'new',
    "callAnalysis" JSONB,
    "formData"     JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_blueprintId_idx" ON "Lead"("blueprintId");
CREATE INDEX "Lead_tenantId_idx" ON "Lead"("tenantId");
CREATE INDEX "Lead_tenantId_status_idx" ON "Lead"("tenantId", "status");

-- ── Appointment ──────────────────────────────────────────────────────
CREATE TABLE "Appointment" (
    "id"          TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "leadId"      TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "confirmed"   BOOLEAN NOT NULL DEFAULT false,
    "notes"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Appointment_leadId_key" ON "Appointment"("leadId");
CREATE INDEX "Appointment_blueprintId_idx" ON "Appointment"("blueprintId");
CREATE INDEX "Appointment_tenantId_idx" ON "Appointment"("tenantId");
CREATE INDEX "Appointment_tenantId_scheduledAt_idx" ON "Appointment"("tenantId", "scheduledAt");

-- ── ScheduledReminder ────────────────────────────────────────────────
CREATE TABLE "ScheduledReminder" (
    "id"            TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "messageType"   TEXT NOT NULL,
    "messageBody"   TEXT NOT NULL,
    "toNumber"      TEXT NOT NULL,
    "sendAt"        TIMESTAMP(3) NOT NULL,
    "sentAt"        TIMESTAMP(3),
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScheduledReminder_appointmentId_messageType_key" ON "ScheduledReminder"("appointmentId", "messageType");
CREATE INDEX "ScheduledReminder_status_sendAt_idx" ON "ScheduledReminder"("status", "sendAt");
CREATE INDEX "ScheduledReminder_tenantId_idx" ON "ScheduledReminder"("tenantId");

-- ── CommandLog ───────────────────────────────────────────────────────
CREATE TABLE "CommandLog" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "rawInput"    TEXT NOT NULL,
    "intentType"  TEXT NOT NULL,
    "blueprintId" TEXT,
    "success"     BOOLEAN NOT NULL,
    "errorMsg"    TEXT,
    "durationMs"  INTEGER,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommandLog_tenantId_idx" ON "CommandLog"("tenantId");
CREATE INDEX "CommandLog_tenantId_createdAt_idx" ON "CommandLog"("tenantId", "createdAt");

-- ── Foreign Keys ─────────────────────────────────────────────────────
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_blueprintId_fkey"
    FOREIGN KEY ("blueprintId") REFERENCES "CampaignBlueprint"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_blueprintId_fkey"
    FOREIGN KEY ("blueprintId") REFERENCES "CampaignBlueprint"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduledReminder" ADD CONSTRAINT "ScheduledReminder_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
