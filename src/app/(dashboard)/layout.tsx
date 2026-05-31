/**
 * src/app/(dashboard)/layout.tsx
 * Dashboard route group layout.
 *
 * Guard: no AgencyProfile found for this user → redirect to /onboarding
 *
 * Tenant re-keying:
 *   While Clerk's org JWT is still propagating, API routes write rows under a
 *   transient `pending:${userId}` tenant id (see the canonical auth pattern in
 *   CLAUDE.md). Once orgId is available we migrate every such row to the real
 *   orgId so nothing is orphaned across the two namespaces.
 */

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/services/brandingService";
import { SubscriptionBanner } from "@/components/access/SubscriptionBanner";

/**
 * Migrates all rows from `pending:${userId}` to `orgId`.
 *
 * - 1-per-tenant models (tenantId @unique) are only moved when no row already
 *   exists under orgId, to avoid unique-constraint collisions.
 * - Many-row models use updateMany; each is wrapped independently so one
 *   failure (e.g. Lead's @@unique([tenantId, email])) never blocks the others.
 *
 * Best-effort and non-fatal: a re-key failure must never block dashboard access.
 */
async function reKeyPendingTenant(userId: string, orgId: string): Promise<void> {
  const pendingKey = `pending:${userId}`;
  if (pendingKey === orgId) return;

  const moveUnique = async (
    label: string,
    find: (tenantId: string) => Promise<{ id: string } | null>,
    move: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      const [pending, existing] = await Promise.all([find(pendingKey), find(orgId)]);
      if (pending && !existing) {
        await move();
        console.log(`[dashboard/layout] Re-keyed ${label} ${pendingKey} → ${orgId}`);
      }
    } catch (e) {
      console.error(`[dashboard/layout] ${label} re-key failed:`, e);
    }
  };

  await Promise.all([
    moveUnique("AgencyProfile",
      (t) => prisma.agencyProfile.findUnique({ where: { tenantId: t }, select: { id: true } }),
      () => prisma.agencyProfile.update({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveUnique("MetaConnection",
      (t) => prisma.metaConnection.findUnique({ where: { tenantId: t }, select: { id: true } }),
      () => prisma.metaConnection.update({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveUnique("CalendarConnection",
      (t) => prisma.calendarConnection.findUnique({ where: { tenantId: t }, select: { id: true } }),
      () => prisma.calendarConnection.update({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveUnique("AgencySubscription",
      (t) => prisma.agencySubscription.findUnique({ where: { tenantId: t }, select: { id: true } }),
      () => prisma.agencySubscription.update({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveUnique("AgencyBranding",
      (t) => prisma.agencyBranding.findUnique({ where: { tenantId: t }, select: { id: true } }),
      () => prisma.agencyBranding.update({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
  ]);

  const moveMany = async (label: string, run: () => Promise<{ count: number }>): Promise<void> => {
    try {
      const { count } = await run();
      if (count > 0) console.log(`[dashboard/layout] Re-keyed ${count} ${label} ${pendingKey} → ${orgId}`);
    } catch (e) {
      console.error(`[dashboard/layout] ${label} re-key failed:`, e);
    }
  };

  await Promise.all([
    moveMany("CampaignBlueprint", () => prisma.campaignBlueprint.updateMany({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveMany("Lead",             () => prisma.lead.updateMany({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveMany("Appointment",      () => prisma.appointment.updateMany({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveMany("AgentAction",      () => prisma.agentAction.updateMany({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
    moveMany("AgentInstruction", () => prisma.agentInstruction.updateMany({ where: { tenantId: pendingKey }, data: { tenantId: orgId } })),
  ]);
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userId: string | null = null;
  let orgId: string | null = null;

  try {
    const authResult = await auth();
    userId = authResult.userId ?? null;
    orgId = authResult.orgId ?? null;
  } catch {
    // Clerk context unavailable — page-level guards handle auth
  }

  // Guard: must have a valid AgencyProfile to access the dashboard
  if (userId) {
    // Fast path — if the profile already lives under orgId, migration is done.
    let agencyProfile: { id: string } | null = orgId
      ? await prisma.agencyProfile.findUnique({ where: { tenantId: orgId }, select: { id: true } })
      : null;

    if (!agencyProfile) {
      // Profile not under orgId yet — re-key any pending-namespaced rows, then re-check.
      if (orgId) {
        await reKeyPendingTenant(userId, orgId);
        agencyProfile = await prisma.agencyProfile.findUnique({
          where:  { tenantId: orgId },
          select: { id: true },
        });
      }

      // Still nothing under orgId (e.g. orgId not yet propagated) — accept the
      // pending profile so the user isn't bounced mid-propagation.
      if (!agencyProfile) {
        agencyProfile = await prisma.agencyProfile.findUnique({
          where:  { tenantId: `pending:${userId}` },
          select: { id: true },
        });
      }
    }

    // No profile found anywhere → send to onboarding
    if (!agencyProfile) {
      redirect("/onboarding");
    }
  }

  // White-label (Sprint 12): override the gold accent with the agency's primary
  // colour, dashboard-wide. A later <style> wins over the globals.css :root var.
  let brandStyle: string | null = null;
  if (userId) {
    const tenantId = orgId ?? `pending:${userId}`;
    const branding = await getBranding(tenantId).catch(() => null);
    const raw = branding?.primaryColour?.trim().replace(/^#/, "");
    if (raw && /^[0-9a-fA-F]{6}$/.test(raw)) {
      brandStyle = `:root{--gold:#${raw};}`;
    }
  }

  return (
    <div className="min-h-screen bg-black">
      {brandStyle && <style dangerouslySetInnerHTML={{ __html: brandStyle }} />}
      <SubscriptionBanner />
      {children}
    </div>
  );
}
