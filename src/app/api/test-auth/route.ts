// src/app/api/test-auth/route.ts
// TEMPORARY: Stage 03 acceptance test route.
// Verifies that getTenantId() throws UNAUTHORIZED when no org is in session.
// This file will be deleted after Stage 03 is confirmed complete.

import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> { // eslint-disable-line @typescript-eslint/no-unused-vars
  try {
    const tenantId = await getTenantId();
    return NextResponse.json({ tenantId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.startsWith("UNAUTHORIZED")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
