/**
 * GET /api/auth/check-session
 * Lightweight endpoint — returns userId and orgId from the current JWT.
 * Used by setup-org to poll until the server-side JWT has the orgId
 * before navigating to the dashboard (avoids Guard 1 firing on stale JWT).
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  return NextResponse.json({ userId: userId ?? null, orgId: orgId ?? null });
}
