/**
 * src/app/api/auth/meta/status/route.ts
 * GET /api/auth/meta/status
 *
 * Returns the authenticated tenant's Meta connection status.
 * The decrypted access token is NEVER included in the response.
 *
 * Response shapes:
 *   { connected: false, reason: "not_connected" }
 *   { connected: false, reason: "expired", expiredAt: ISO string }
 *   { connected: true, adAccountId, pageId, pixelId, instagramActorId, tokenExpiresAt, connectedAt }
 */

import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getMetaConnectionStatus } from "@/lib/services/metaAuthService";

export async function GET(): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getMetaConnectionStatus(tenantId);
  return NextResponse.json(status);
}
