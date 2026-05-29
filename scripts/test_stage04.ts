// scripts/test_stage04.ts
// Stage 04 acceptance tests
// Run with: node -r esbuild-register scripts/test_stage04.ts

// Patch module resolution for @/ alias
import { register } from "module";
import { pathToFileURL } from "url";

// ─── Test 1: validateStripeMandate returns false (no customer) ────────────────
async function testValidateStripeMandateReturnsFalse(): Promise<void> {
  // Use an invalid key — Stripe will reject it, function must return false (not throw)
  process.env.STRIPE_SECRET_KEY = "sk_test_invalid_key_stage04_test";

  const { validateStripeMandate } = await import("../src/lib/services/stripeService");
  const result = await validateStripeMandate("org_nonexistent_tenant_stage04");

  if (result !== false) {
    throw new Error(`FAIL: validateStripeMandate returned ${result}, expected false`);
  }
  console.log("✅ Test 1 PASS: validateStripeMandate returns false for non-existent tenant");
}

// ─── Test 2: validateStripeMandate returns false (no key configured) ──────────
async function testValidateStripeMandateNoKey(): Promise<void> {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;

  const { validateStripeMandate } = await import("../src/lib/services/stripeService");
  const result = await validateStripeMandate("org_any_tenant");

  process.env.STRIPE_SECRET_KEY = saved;

  if (result !== false) {
    throw new Error(`FAIL: validateStripeMandate returned ${result} when key missing, expected false`);
  }
  console.log("✅ Test 2 PASS: validateStripeMandate returns false when STRIPE_SECRET_KEY not set");
}

async function main(): Promise<void> {
  console.log("=== Stage 04 Acceptance Tests ===\n");
  await testValidateStripeMandateReturnsFalse();
  await testValidateStripeMandateNoKey();
  console.log("\n✅ All Stage 04 Stripe tests passed.");
}

main().catch((err: unknown) => {
  console.error("UNCAUGHT ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
