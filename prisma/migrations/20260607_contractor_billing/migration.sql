-- Contractor billing (business pivot): sell booked site surveys to local roofing
-- contractors. £700 lock-in (2 prepaid surveys) + £350 per booking off-session.
-- Additive only: two new tables + a nullable contractor link on CampaignBlueprint.

-- CreateTable
CREATE TABLE "Contractor" (
    "id"                     TEXT NOT NULL,
    "tenantId"               TEXT NOT NULL,
    "name"                   TEXT NOT NULL,
    "city"                   TEXT NOT NULL,
    "email"                  TEXT NOT NULL,
    "phone"                  TEXT,
    "stripeCustomerId"       TEXT,
    "stripePaymentMethodId"  TEXT,
    "pricePerSurveyGbp"      INTEGER NOT NULL DEFAULT 350,
    "lockInFeeGbp"           INTEGER NOT NULL DEFAULT 700,
    "prepaidCreditRemaining" INTEGER NOT NULL DEFAULT 0,
    "lockInPaidAt"           TIMESTAMP(3),
    "status"                 TEXT NOT NULL DEFAULT 'pending',
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyCharge" (
    "id"                    TEXT NOT NULL,
    "appointmentId"         TEXT NOT NULL,
    "contractorId"          TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "blueprintId"           TEXT,
    "amountGbp"             INTEGER NOT NULL,
    "kind"                  TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT,
    "failureReason"         TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyCharge_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CampaignBlueprint" ADD COLUMN IF NOT EXISTS "contractorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_stripeCustomerId_key" ON "Contractor"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Contractor_tenantId_idx" ON "Contractor"("tenantId");

-- CreateIndex
CREATE INDEX "Contractor_status_idx" ON "Contractor"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyCharge_appointmentId_key" ON "SurveyCharge"("appointmentId");

-- CreateIndex
CREATE INDEX "SurveyCharge_contractorId_idx" ON "SurveyCharge"("contractorId");

-- CreateIndex
CREATE INDEX "SurveyCharge_tenantId_idx" ON "SurveyCharge"("tenantId");

-- CreateIndex
CREATE INDEX "SurveyCharge_status_idx" ON "SurveyCharge"("status");

-- CreateIndex
CREATE INDEX "CampaignBlueprint_contractorId_idx" ON "CampaignBlueprint"("contractorId");

-- AddForeignKey
ALTER TABLE "SurveyCharge" ADD CONSTRAINT "SurveyCharge_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyCharge" ADD CONSTRAINT "SurveyCharge_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignBlueprint" ADD CONSTRAINT "CampaignBlueprint_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
