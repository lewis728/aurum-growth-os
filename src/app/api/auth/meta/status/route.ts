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

import { NextRequest, NextResponse } from "next/server";
import { getMetaConnectionStatus } from "@/lib/services/metaAuthService";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const status = await getMetaConnectionStatus(tenantId);
  return NextResponse.json(status);
}
