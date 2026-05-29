/**
 * GET /api/branding/resolve?domain=<hostname>
 * Resolves a custom domain to a tenantId for the middleware custom-domain feature.
 * This route is called by middleware (Edge runtime) which cannot import Prisma directly.
 * This route runs in the Node.js runtime and can safely use Prisma.
 */
import { NextRequest, NextResponse } from "next/server";
import { getBrandingByDomain } from "@/lib/services/brandingService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json({ tenantId: null }, { status: 400 });
  }
  try {
    const branding = await getBrandingByDomain(domain);
    return NextResponse.json({ tenantId: branding?.tenantId ?? null });
  } catch {
    return NextResponse.json({ tenantId: null }, { status: 200 });
  }
}
