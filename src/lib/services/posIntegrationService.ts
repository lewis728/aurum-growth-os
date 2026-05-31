/**
 * src/lib/services/posIntegrationService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * LTV feedback loop (Sprint 10E). The most commercially important loop: feed real
 * transaction values from the client's POS back to Meta via the Conversions API
 * (CAPI), so Meta optimises for high-VALUE buyers, not just any lead.
 *
 * Flow: POS webhook → match lead by email → update actualTransactionValue + ltv →
 * fire a CAPI Purchase event with the real value + SHA256-hashed email.
 *
 * Graceful shell: CAPI fires only when a pixel id + access token are available
 * (blueprint override, else the tenant's MetaConnection). Without them it records
 * the LTV and no-ops the send — so this runs today and lights up once Meta is
 * connected. NEVER THROWS.
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/services/metaAuthService";
import { getMetaAccessToken } from "@/lib/services/metaAuthService";

const META_GRAPH = "https://graph.facebook.com/v20.0";

export interface PosEvent {
  patientEmail:     string;
  transactionValue: number;
  treatmentType?:   string;
  date?:            string;
}

export interface PosResult {
  matched:     boolean;
  leadId:      string | null;
  ltv:         number | null;
  capiSent:    boolean;
  note?:       string;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Resolves the CAPI credentials for a blueprint: prefer the (encrypted) blueprint
 * overrides, else the tenant's MetaConnection. Returns null if unavailable.
 */
async function resolveCapiCreds(
  blueprint: { tenantId: string; metaPixelId: string | null; metaAccessToken: string | null },
): Promise<{ pixelId: string; accessToken: string } | null> {
  let pixelId = blueprint.metaPixelId ?? null;
  let accessToken: string | null = null;

  if (blueprint.metaAccessToken) {
    try { accessToken = decryptToken(blueprint.metaAccessToken); } catch { accessToken = null; }
  }

  // Fall back to the tenant's MetaConnection (decrypted token + stored pixel).
  if (!accessToken || !pixelId) {
    try {
      const [token, conn] = await Promise.all([
        getMetaAccessToken(blueprint.tenantId).catch(() => null),
        prisma.metaConnection.findUnique({ where: { tenantId: blueprint.tenantId }, select: { pixelId: true } }),
      ]);
      accessToken = accessToken ?? token;
      pixelId = pixelId ?? conn?.pixelId ?? null;
    } catch { /* non-fatal */ }
  }

  return pixelId && accessToken ? { pixelId, accessToken } : null;
}

/** Fires a Meta CAPI Purchase event. NEVER THROWS — returns true on 200. */
async function fireCapiPurchase(
  pixelId: string,
  accessToken: string,
  hashedEmail: string,
  value: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${META_GRAPH}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name:  "Purchase",
          event_time:  Math.floor(Date.now() / 1000),
          action_source: "physical_store",
          user_data:   { em: [hashedEmail] },
          custom_data: { currency: "GBP", value },
        }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[posIntegration] CAPI HTTP ${res.status}: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[posIntegration] CAPI send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Records a POS transaction against the matching lead and feeds value back to Meta.
 * NEVER THROWS.
 */
export async function recordPosTransaction(
  blueprintId: string,
  tenantId: string,
  event: PosEvent,
): Promise<PosResult> {
  try {
    const blueprint = await prisma.campaignBlueprint.findFirst({
      where:  { id: blueprintId, tenantId },
      select: { id: true, tenantId: true, metaPixelId: true, metaAccessToken: true },
    });
    if (!blueprint) return { matched: false, leadId: null, ltv: null, capiSent: false, note: "blueprint not found" };

    // Match the lead by email within this blueprint/tenant.
    const lead = await prisma.lead.findFirst({
      where:  { blueprintId, tenantId, email: { equals: event.patientEmail, mode: "insensitive" } },
      select: { id: true, ltv: true },
    });
    if (!lead) {
      return { matched: false, leadId: null, ltv: null, capiSent: false, note: "no matching lead for email" };
    }

    const newLtv = (lead.ltv ?? 0) + event.transactionValue;
    await prisma.lead.update({
      where: { id: lead.id },
      data:  { actualTransactionValue: event.transactionValue, ltv: newLtv },
    });

    // Feed the real value back to Meta (graceful — no-op without creds).
    let capiSent = false;
    const creds = await resolveCapiCreds(blueprint);
    if (creds) {
      capiSent = await fireCapiPurchase(creds.pixelId, creds.accessToken, sha256(event.patientEmail), event.transactionValue);
    }

    return {
      matched: true, leadId: lead.id, ltv: newLtv, capiSent,
      note: creds ? undefined : "CAPI skipped — no Meta pixel/token configured",
    };
  } catch (err) {
    console.error(`[posIntegration] recordPosTransaction failed for ${blueprintId}:`, err instanceof Error ? err.message : err);
    return { matched: false, leadId: null, ltv: null, capiSent: false, note: "error" };
  }
}
