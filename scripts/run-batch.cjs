/**
 * scripts/run-batch.cjs
 * Launcher for long-running batch scripts (seed, training). It forces Prisma onto
 * the DIRECT (session-mode) connection — DIRECT_URL, port 5432 — instead of the
 * transaction pooler (DATABASE_URL, port 6543).
 *
 * Why: the Supabase transaction pooler is built for short serverless bursts and
 * intermittently refuses/recycles connections during the long OpenAI waits between
 * DB writes in a batch run (observed ECONNREFUSED mid-seed). The direct session
 * connection holds a stable long-lived link, which is what migrations/seeds want.
 *
 * Usage: node scripts/run-batch.cjs <tsx-entry> [args...]
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const [, , entry, ...rest] = process.argv;
if (!entry) {
  console.error("run-batch: missing entry file");
  process.exit(1);
}

const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");
try {
  execFileSync(tsx, [entry, ...rest], { stdio: "inherit", env: process.env });
} catch (err) {
  process.exit(err && typeof err.status === "number" ? err.status : 1);
}
