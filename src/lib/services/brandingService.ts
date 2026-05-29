// src/lib/services/brandingService.ts
// Agency white-label branding service.
// Available to ALL authenticated agency owners — no tier checks.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { AgencyBranding } from "@prisma/client";

// ── Validation helpers ────────────────────────────────────────────────

const HEX_RE = /^[0-9A-Fa-f]{6}$/;
const HOSTNAME_RE =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function validateHex(value: string, field: string): void {
  if (!HEX_RE.test(value)) {
    throw new Error(
      `${field} must be a valid 6-character hex string without # (received: "${value}")`
    );
  }
}

function validateHostname(value: string): void {
  if (!HOSTNAME_RE.test(value)) {
    throw new Error(
      `customDomain must be a valid hostname such as app.youragency.com (received: "${value}")`
    );
  }
}

// ── getBranding ───────────────────────────────────────────────────────
// Cached per React render tree — safe to call multiple times in one request.
// Returns null if no branding configured (caller uses Aurum defaults).
// NEVER throws.

export const getBranding = cache(
  async (tenantId: string): Promise<AgencyBranding | null> => {
    try {
      return await prisma.agencyBranding.findUnique({
        where: { tenantId },
      });
    } catch (err) {
      console.warn("[brandingService] getBranding failed:", err);
      return null;
    }
  }
);

// ── getBrandingByDomain ───────────────────────────────────────────────
// Used by middleware to resolve custom domains to tenantId.
// Returns null if domain not found.
// NEVER throws.

export async function getBrandingByDomain(
  domain: string
): Promise<AgencyBranding | null> {
  try {
    return await prisma.agencyBranding.findUnique({
      where: { customDomain: domain },
    });
  } catch (err) {
    console.warn("[brandingService] getBrandingByDomain failed:", err);
    return null;
  }
}

// ── updateBranding ────────────────────────────────────────────────────
// Validates colours and domain format, then upserts the AgencyBranding row.
// Throws with descriptive messages on validation failure.

export type BrandingUpdateData = Partial<
  Omit<AgencyBranding, "id" | "tenantId" | "createdAt" | "updatedAt">
>;

export async function updateBranding(
  tenantId: string,
  data: BrandingUpdateData
): Promise<AgencyBranding> {
  // Validate colours if provided
  if (data.primaryColour !== undefined) {
    validateHex(data.primaryColour, "primaryColour");
  }
  if (data.accentColour !== undefined) {
    validateHex(data.accentColour, "accentColour");
  }

  // Validate custom domain format if provided
  if (data.customDomain !== undefined && data.customDomain !== null) {
    validateHostname(data.customDomain);
  }

  try {
    return await prisma.agencyBranding.upsert({
      where: { tenantId },
      create: {
        tenantId,
        agencyName: data.agencyName ?? "My Agency",
        ...data,
      },
      update: data,
    });
  } catch (err) {
    throw new Error(
      `[brandingService] updateBranding failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
