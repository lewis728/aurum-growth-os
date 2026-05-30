// src/app/api/agency/branding/verify-domain/route.ts
// GET — checks DNS propagation status for the agency's configured custom domain.
// Returns: { verified, cnameTarget, domain }

import { NextRequest, NextResponse } from "next/server";
import { getBranding } from "@/lib/services/brandingService";
import { verifyDomain } from "@/lib/services/vercelDomainService";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const branding = await getBranding(tenantId);
  if (!branding?.customDomain) {
    return NextResponse.json(
      { error: "No custom domain configured" },
      { status: 400 }
    );
  }

  try {
    const { verified, cnameTarget } = await verifyDomain(branding.customDomain);
    return NextResponse.json({
      domain: branding.customDomain,
      verified,
      cnameTarget,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Domain verification failed" },
      { status: 502 }
    );
  }
}
