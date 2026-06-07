/**
 * /api/contractors
 *   POST — create a local roofing contractor (the buyer of booked site surveys),
 *          optionally linking them to a city CampaignBlueprint.
 *   GET  — list this tenant's contractors.
 *
 * Contractors are BUYERS, not logged-in tenants — Lewis onboards them. Tenant-scoped
 * via the standard auth() pattern (orgId ?? pending:userId), per CLAUDE.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface CreateContractorBody {
  name: string;
  city: string;
  email: string;
  phone?: string;
  blueprintId?: string;
  pricePerSurveyGbp?: number;
  lockInFeeGbp?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: CreateContractorBody;
  try {
    body = (await req.json()) as CreateContractorBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!body.city?.trim()) return NextResponse.json({ error: "city is required" }, { status: 400 });
  if (!body.email?.trim() || !EMAIL_RE.test(body.email.trim())) {
    return NextResponse.json({ error: "a valid email is required" }, { status: 400 });
  }

  // If linking to a city campaign, it must belong to this tenant.
  if (body.blueprintId) {
    const bp = await prisma.campaignBlueprint.findFirst({
      where: { id: body.blueprintId, tenantId },
      select: { id: true },
    });
    if (!bp) return NextResponse.json({ error: "blueprintId not found for this tenant" }, { status: 404 });
  }

  const price =
    typeof body.pricePerSurveyGbp === "number" && body.pricePerSurveyGbp > 0
      ? Math.round(body.pricePerSurveyGbp)
      : 350;
  const lockIn =
    typeof body.lockInFeeGbp === "number" && body.lockInFeeGbp > 0 ? Math.round(body.lockInFeeGbp) : 700;

  const contractor = await prisma.$transaction(async (tx) => {
    const c = await tx.contractor.create({
      data: {
        tenantId,
        name: body.name.trim(),
        city: body.city.trim(),
        email: body.email.trim(),
        phone: body.phone?.trim() || null,
        pricePerSurveyGbp: price,
        lockInFeeGbp: lockIn,
      },
    });
    if (body.blueprintId) {
      await tx.campaignBlueprint.update({
        where: { id: body.blueprintId },
        data: { contractorId: c.id },
      });
    }
    return c;
  });

  return NextResponse.json({
    id: contractor.id,
    name: contractor.name,
    city: contractor.city,
    status: contractor.status,
    pricePerSurveyGbp: contractor.pricePerSurveyGbp,
    lockInFeeGbp: contractor.lockInFeeGbp,
  });
}

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const contractors = await prisma.contractor.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      city: true,
      email: true,
      status: true,
      pricePerSurveyGbp: true,
      lockInFeeGbp: true,
      prepaidCreditRemaining: true,
      lockInPaidAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ contractors });
}
