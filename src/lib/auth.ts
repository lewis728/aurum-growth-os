// src/lib/auth.ts
// Clerk authentication helpers for Aurum Growth OS.
// SERVER-SIDE ONLY. Never import inside a "use client" component.
//
// CRITICAL: getTenantId() must be the FIRST call in every API route handler
// (except webhooks). If it throws, return 401 immediately.

import { auth } from "@clerk/nextjs/server";

/**
 * Extracts the Clerk Organisation ID (tenantId) from the current request context.
 *
 * In Aurum Growth OS, every client is a Clerk Organisation.
 * The Organisation ID is the tenantId used throughout the entire codebase.
 * This extraction happens ONCE — here — and nowhere else.
 *
 * @throws {Error} UNAUTHORIZED: No organisation context in session
 *   — if the user has no active organisation in their session JWT.
 */
export async function getTenantId(): Promise<string> {
  const { orgId } = await auth();

  if (!orgId) {
    throw new Error("UNAUTHORIZED: No organisation context in session");
  }

  return orgId;
}

/**
 * Extracts the Clerk User ID from the current request context.
 * Used for per-user audit logging. tenantId (orgId) is used for data isolation.
 *
 * @throws {Error} UNAUTHORIZED: User is not authenticated
 */
export async function getUserId(): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("UNAUTHORIZED: User is not authenticated");
  }

  return userId;
}
