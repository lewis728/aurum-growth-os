// src/app/api/agency/clients/route.ts
// GET — returns all CampaignBlueprint rows for the authenticated agency tenant,
//        with aggregated lead and appointment counts.

import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export interface ClientSummary {
  id:               string;
  businessName:     string;
  vertical:         string;
  status:           string;
  dailyBudgetUsd:   number;
  leadCount:        number;
  appointmentCount: number;
  createdAt:        string;
}

export async function GET(): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = await getTenantId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blueprints = await prisma.campaignBlueprint.findMany({
    where: { tenantId },
    select: {
      id:             true,
      businessName:   true,
      vertical:       true,
      status:         true,
      dailyBudgetUsd: true,
      createdAt:      true,
      _count: {
        select: {
          leads:        true,
          appointments: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const clients: ClientSummary[] = blueprints.map((bp) => ({
    id:               bp.id,
    businessName:     bp.businessName,
    vertical:         bp.vertical,
    status:           bp.status,
    dailyBudgetUsd:   bp.dailyBudgetUsd,
    leadCount:        bp._count.leads,
    appointmentCount: bp._count.appointments,
    createdAt:        bp.createdAt.toISOString(),
  }));

  return NextResponse.json({ clients });
}
