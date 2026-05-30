-- CreateTable
CREATE TABLE "AgentInstruction" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentInstruction_tenantId_blueprintId_idx" ON "AgentInstruction"("tenantId", "blueprintId");

-- AddForeignKey
ALTER TABLE "AgentInstruction" ADD CONSTRAINT "AgentInstruction_blueprintId_fkey"
    FOREIGN KEY ("blueprintId") REFERENCES "CampaignBlueprint"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
