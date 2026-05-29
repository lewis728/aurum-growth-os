// src/lib/prisma.ts
// Singleton PrismaClient with global caching for Next.js hot reload.
// This is the ONLY place PrismaClient is instantiated in the entire codebase.
// SERVER-SIDE ONLY. Never import inside a "use client" component.

import { PrismaClient } from "@prisma/client";

// Extend globalThis to hold the singleton across hot-reload cycles in development.
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

// In development, attach to global so hot-reload reuses the same instance.
// In production, the module cache handles singleton behaviour.
if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
