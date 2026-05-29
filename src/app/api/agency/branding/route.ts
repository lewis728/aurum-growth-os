// src/app/api/agency/branding/route.ts
// GET  — returns current branding config (or defaults); no subscription check
// PATCH — updates branding config; requires active/trialing subscription

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTenantId } from "@/lib/auth";
import { getBranding, updateBranding } from "@/lib/services/brandingService";
import { validateStripeMandate } from "@/lib/services/stripeService";
import {
  addCustomDomain,
  removeCustomDomain,
} from "@/lib/services/vercelDomainService";

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  agencyName:               "My Agency",
  logoUrl:                  null,
  primaryColour:            "C9A84C",
  accentColour:             "FFFFFF",
  customDomain:             null,
  supportEmail:             null,
  fromName:                 null,
  onboardingWelcomeMessage: null,
};

// ── PATCH body schema ─────────────────────────────────────────────────────────
const PatchSchema = z.object({
  agencyName:               z.string().min(1).max(100).optional(),
  logoUrl:                  z.string().url().nullable().optional(),
  primaryColour:            z.string().regex(/^[0-9A-Fa-f]{6}$/).optional(),
  accentColour:             z.string().regex(/^[0-9A-Fa-f]{6}$/).optional(),
  customDomain:             z.string().nullable().optional(),
  supportEmail:             z.string().email().nullable().optional(),
  fromName:                 z.string().max(100).nullable().optional(),
  onboardingWelcomeMessage: z.string().max(2000).nullable().optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const branding = await getBranding(tenantId);

  // Return saved branding or defaults — never 402 on GET
  return NextResponse.json(branding ?? { ...DEFAULTS, tenantId, id: null });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Subscription mandate check
  const mandateOk = await validateStripeMandate(tenantId);
  if (!mandateOk) {
    return NextResponse.json({ error: "Subscription required" }, { status: 402 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const data = parsed.data;

  // Handle custom domain change
  if (data.customDomain !== undefined) {
    const existing = await getBranding(tenantId);
    const oldDomain = existing?.customDomain ?? null;
    const newDomain = data.customDomain;

    if (oldDomain && oldDomain !== newDomain) {
      // Remove old domain from Vercel — non-fatal
      try {
        await removeCustomDomain(oldDomain);
      } catch (err) {
        console.warn("[agency/branding] removeCustomDomain failed:", err);
      }
    }

    if (newDomain) {
      try {
        await addCustomDomain(newDomain);
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to add custom domain: ${err instanceof Error ? err.message : String(err)}` },
          { status: 502 }
        );
      }
    }
  }

  try {
    const updated = await updateBranding(tenantId, data);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update branding" },
      { status: 500 }
    );
  }
}
