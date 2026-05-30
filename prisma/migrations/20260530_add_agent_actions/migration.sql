-- CreateTable
CREATE TABLE "AgentAction" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "blueprintId"  TEXT NOT NULL,
    "agentName"    TEXT NOT NULL,
    "actionType"   TEXT NOT NULL,
    "reasoning"    TEXT NOT NULL,
    "outcome"      TEXT NOT NULL,
    "metricBefore" DOUBLE PRECISION,
    "metricAfter"  DOUBLE PRECISION,
    "executedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentAction_tenantId_blueprintId_idx" ON "AgentAction"("tenantId", "blueprintId");

-- CreateIndex
CREATE INDEX "AgentAction_executedAt_idx" ON "AgentAction"("executedAt");

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_blueprintId_fkey"
    FOREIGN KEY ("blueprintId") REFERENCES "CampaignBlueprint"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
