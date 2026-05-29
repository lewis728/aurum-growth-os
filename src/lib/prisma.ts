// src/lib/prisma.ts
// Singleton PrismaClient with global caching for Next.js hot reload.
// This is the ONLY place PrismaClient is instantiated in the entire codebase.
// SERVER-SIDE ONLY. Never import inside a "use client" component.
// Prisma 7 requires a driver adapter — we use @prisma/adapter-pg with the pg pool.
import { PrismaClient } from "@prisma/client";
import { PrismaPg }     from "@prisma/adapter-pg";
import { Pool }         from "pg";

// Extend globalThis to hold the singleton across hot-reload cycles in development.
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const pool    = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
  });
}

export const prisma: PrismaClient =
  global.prisma ?? createPrismaClient();

// In development, attach to global so hot-reload reuses the same instance.
// In production, the module cache handles singleton behaviour.
if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
