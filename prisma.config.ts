// prisma.config.ts
// Prisma 7 configuration file.
// Connection URLs live here per Prisma 7 spec (not in schema.prisma).
// DATABASE_URL: pooled connection (pgbouncer) for runtime queries.
// DIRECT_URL: non-pooled connection required for migrations.

import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { readFileSync } from 'node:fs';

// Load .env.local for local development
function loadEnvLocal(): void {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)="(.*)"$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2];
      }
    }
  } catch {
    // .env.local may not exist in CI/production — fall through to system env
  }
}

loadEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

if (!databaseUrl) throw new Error('DATABASE_URL is not set');
// directUrl is consumed by Prisma CLI via the DIRECT_URL env var (set in schema.prisma
// or via the env() function). The Prisma 7 defineConfig Datasource type only accepts
// { url, shadowDatabaseUrl } — directUrl is not a recognised field here.

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: databaseUrl,
  },
});
