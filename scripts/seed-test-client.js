/**
 * scripts/seed-test-client.js
 * Seeds a LIVE test client (CampaignBlueprint + AIRepresentative + ClientBrief)
 * so you can fire a lead at it and watch the speed-to-lead call + SMS fire —
 * WITHOUT the wizard, Stripe gate, or Clerk auth.
 *
 * Usage:
 *   node scripts/seed-test-client.js [agentName] [retellAgentId]
 *
 * Env:
 *   DATABASE_URL        required (Prisma)
 *   TEST_TENANT_ID      optional, default "pending:smoke-test"
 *   RETELL_AGENT_ID     optional — if set globally, you can omit the arg
 *
 * Prints the blueprintId and the exact next command to fire a lead.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const agentName     = process.argv[2] || "Sophie";
  const retellAgentId = process.argv[3] || process.env.RETELL_AGENT_ID || null;
  const tenantId      = process.env.TEST_TENANT_ID || "pending:smoke-test";

  // voice carries the per-blueprint Retell agent id the call trigger reads;
  // if null here, speedToLeadService falls back to RETELL_AGENT_ID at call time.
  const voice = retellAgentId ? { retellAgentId } : {};

  const blueprint = await prisma.campaignBlueprint.create({
    data: {
      tenantId,
      status:         "live", // LIVE so the speed-to-lead call actually fires
      vertical:       "aesthetics",
      businessName:   "Smoke Test Clinic",
      targetLocation: "London, UK",
      dailyBudgetUsd: 50,
      offerHook:      "Free consultation for anti-wrinkle treatment",
      businessDescription: "A test aesthetics clinic used to prove the speed-to-lead loop.",
      creative:    {},
      mediaBuying: {},
      deployment:  {},
      voice,
      crm:         {},
    },
  });

  await prisma.aIRepresentative.create({
    data: {
      blueprintId: blueprint.id,
      tenantId,
      repName:     agentName,
      voiceId:     "female-british",
    },
  });

  await prisma.clientBrief.create({
    data: {
      blueprintId:          blueprint.id,
      tenantId,
      idealCustomerProfile: "Women 30-55 in London considering anti-wrinkle treatment",
      badLeadSignals:       "Out of area, under 25, price-shoppers with no intent",
      brandTone:            "Warm, reassuring, premium but not clinical",
      keyUSPs:              "Free consultation; experienced nurse prescribers; natural-looking results",
      targetCplGbp:         40,
      averageClientValue:   600,
      budgetHardLimit:      100,
      approvalThreshold:    25,
      complianceNotes:      "Never guarantee results; never make medical claims; no before/after of named patients without consent",
    },
  });

  console.log("\n✅ Seeded LIVE test client");
  console.log("   blueprintId :", blueprint.id);
  console.log("   tenantId    :", tenantId);
  console.log("   agent       :", agentName);
  console.log("   retellAgent :", retellAgentId || "(falls back to RETELL_AGENT_ID env)");
  console.log("\nNext — fire a lead at YOUR OWN phone (E.164, e.g. +447...):");
  console.log(`   node scripts/test-webhook.js ${blueprint.id} +44XXXXXXXXXX\n`);
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
