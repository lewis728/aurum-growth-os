-- Phase 2 additions: MetaConnection, CalendarConnection, VerticalProfile,
-- AgencyBranding, AgencySubscription, SpendFeeRecord, MonthlyReport, AIRepresentative
-- Plus: aggregated column on CampaignBlueprint

-- CreateEnum
CREATE TYPE "RepresentativePersonality" AS ENUM ('PROFESSIONAL', 'WARM', 'DIRECT', 'CONSULTATIVE');

-- AlterTable: add aggregated column to CampaignBlueprint
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "aggregated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: MetaConnection
CREATE TABLE IF NOT EXISTS "MetaConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "pixelId" TEXT,
    "facebookPageId" TEXT,
    "instagramActorId" TEXT,
    "appId" TEXT,
    "appSecret" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CalendarConnection
CREATE TABLE IF NOT EXISTS "CalendarConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'calendly',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "webhookUri" TEXT,
    "calendlyUserUri" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VerticalProfile
CREATE TABLE IF NOT EXISTS "VerticalProfile" (
    "id" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "systemPromptBase" TEXT NOT NULL,
    "callScriptNotes" TEXT,
    "performanceData" JSONB NOT NULL DEFAULT '{}',
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VerticalProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgencyBranding
CREATE TABLE IF NOT EXISTS "AgencyBranding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agencyName" TEXT NOT NULL DEFAULT 'My Agency',
    "primaryColour" TEXT NOT NULL DEFAULT '#FFFFFF',
    "accentColour" TEXT NOT NULL DEFAULT '#C9A84C',
    "logoUrl" TEXT,
    "customDomain" TEXT,
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "welcomeMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgencyBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AgencySubscription
CREATE TABLE IF NOT EXISTS "AgencySubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "currentSeatCount" INTEGER NOT NULL DEFAULT 0,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgencySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SpendFeeRecord
CREATE TABLE IF NOT EXISTS "SpendFeeRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "blueprintId" TEXT,
    "periodMonth" TEXT NOT NULL,
    "adSpendUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpendFeeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MonthlyReport
CREATE TABLE IF NOT EXISTS "MonthlyReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "reportData" JSONB NOT NULL DEFAULT '{}',
    "reportHtml" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AIRepresentative
CREATE TABLE IF NOT EXISTS "AIRepresentative" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "repName" TEXT NOT NULL,
    "personality" "RepresentativePersonality" NOT NULL DEFAULT 'PROFESSIONAL',
    "customIntroLine" TEXT,
    "customObjectionResponses" JSONB NOT NULL DEFAULT '{}',
    "voiceId" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIRepresentative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MetaConnection_tenantId_key" ON "MetaConnection"("tenantId");
CREATE INDEX IF NOT EXISTS "MetaConnection_tenantId_idx" ON "MetaConnection"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_tenantId_key" ON "CalendarConnection"("tenantId");
CREATE INDEX IF NOT EXISTS "CalendarConnection_tenantId_idx" ON "CalendarConnection"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "VerticalProfile_vertical_key" ON "VerticalProfile"("vertical");
CREATE INDEX IF NOT EXISTS "VerticalProfile_vertical_idx" ON "VerticalProfile"("vertical");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencyBranding_tenantId_key" ON "AgencyBranding"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencyBranding_customDomain_key" ON "AgencyBranding"("customDomain");
CREATE INDEX IF NOT EXISTS "AgencyBranding_tenantId_idx" ON "AgencyBranding"("tenantId");
CREATE INDEX IF NOT EXISTS "AgencyBranding_customDomain_idx" ON "AgencyBranding"("customDomain");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencySubscription_tenantId_key" ON "AgencySubscription"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencySubscription_stripeCustomerId_key" ON "AgencySubscription"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgencySubscription_stripeSubscriptionId_key" ON "AgencySubscription"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "AgencySubscription_tenantId_idx" ON "AgencySubscription"("tenantId");
CREATE INDEX IF NOT EXISTS "AgencySubscription_stripeCustomerId_idx" ON "AgencySubscription"("stripeCustomerId");
CREATE INDEX IF NOT EXISTS "SpendFeeRecord_tenantId_idx" ON "SpendFeeRecord"("tenantId");
CREATE INDEX IF NOT EXISTS "SpendFeeRecord_status_idx" ON "SpendFeeRecord"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "SpendFeeRecord_tenantId_periodMonth_key" ON "SpendFeeRecord"("tenantId", "periodMonth");
CREATE INDEX IF NOT EXISTS "MonthlyReport_tenantId_idx" ON "MonthlyReport"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyReport_tenantId_month_year_key" ON "MonthlyReport"("tenantId", "month", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "AIRepresentative_blueprintId_key" ON "AIRepresentative"("blueprintId");
CREATE INDEX IF NOT EXISTS "AIRepresentative_tenantId_idx" ON "AIRepresentative"("tenantId");
CREATE INDEX IF NOT EXISTS "AIRepresentative_blueprintId_idx" ON "AIRepresentative"("blueprintId");
