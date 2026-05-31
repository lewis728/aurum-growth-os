/**
 * src/app/onboard/[blueprintId]/page.tsx
 * Post-Deploy-Sophie onboarding brief. Server component: resolves the agent +
 * business name, then renders the premium multi-step ClientOnboarding form.
 * Auth-gated by Clerk middleware; tenant-scoped on lookup.
 */
import { redirect, notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ClientOnboarding } from "@/components/onboarding/ClientOnboarding";

export const dynamic = "force-dynamic";

export default async function OnboardPage(
  { params }: { params: { blueprintId: string } }
): Promise<JSX.Element> {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/");
  const tenantId = orgId ?? `pending:${userId}`;

  const blueprint = await prisma.campaignBlueprint.findFirst({
    where:  { id: params.blueprintId, tenantId },
    select: { id: true, businessName: true },
  });
  if (!blueprint) notFound();

  const rep = await prisma.aIRepresentative.findUnique({
    where:  { blueprintId: blueprint.id },
    select: { repName: true },
  });

  return (
    <ClientOnboarding
      blueprintId={blueprint.id}
      agentName={rep?.repName ?? "Sophie"}
      businessName={blueprint.businessName}
    />
  );
}
