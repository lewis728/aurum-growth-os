/**
 * GET /api/outreach/prospects
 * Tenant-scoped pipeline view: all prospects + status counts. Newest first.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  // Optional filters (Part 5): ?vertical=…&country=…&status=…
  const sp = new URL(req.url).searchParams;
  const vertical = sp.get("vertical")?.trim();
  const country = sp.get("country")?.trim();
  const status = sp.get("status")?.trim();

  const prospects = await prisma.outreachProspect.findMany({
    where:   {
      tenantId,
      ...(vertical ? { vertical } : {}),
      ...(country ? { country } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take:    500,
    select: {
      id: true, firstName: true, lastName: true, companyName: true, cleanCompanyName: true,
      website: true, vertical: true, location: true, country: true, contactEmail: true, status: true,
      source: true, customHook: true, fitScore: true, qualified: true, qualifyReason: true,
      emailsSent: true, lastEmailAt: true, repliedAt: true, bookedAt: true, notes: true,
      instantlyLeadId: true, createdAt: true,
    },
  }).catch(() => []);

  // Pipeline buckets for the top strip.
  const counts = {
    pending:   0, // pending + qualifying
    generated: 0, // generated, ready to push
    emailing:  0,
    replied:   0,
    booked:    0,
    closed:    0, // rejected + closed
  };
  for (const p of prospects) {
    if (p.status === "pending" || p.status === "qualifying") counts.pending++;
    else if (p.status === "generated") counts.generated++;
    else if (p.status === "emailing") counts.emailing++;
    else if (p.status === "replied") counts.replied++;
    else if (p.status === "booked") counts.booked++;
    else counts.closed++; // rejected | closed | anything else
  }

  return NextResponse.json({ prospects, counts });
}
