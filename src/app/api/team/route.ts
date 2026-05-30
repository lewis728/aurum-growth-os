/**
 * /api/team
 * GET  — list organisation members with their roles (owner only).
 * POST — invite a member by email with a role (owner only).
 *
 * Roles: owner | manager | viewer (Clerk org roles, prefixed "org:").
 * If the caller has no active org, team management is unavailable (solo account).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getAgencyRole } from "@/lib/access/roles";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["owner", "manager", "viewer"]);

interface TeamMember {
  id:    string;
  role:  string;
  name:  string | null;
  email: string | null;
}

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!orgId)  return NextResponse.json({ members: [], soloAccount: true });

  if ((await getAgencyRole()) !== "owner") {
    return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  }

  try {
    const client = await clerkClient();
    const list = await client.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 });
    const members: TeamMember[] = list.data.map((m): TeamMember => {
      const fullName = [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(" ");
      return {
        id:        m.id,
        role:      m.role.replace(/^org:/, ""),
        name:      fullName.length > 0 ? fullName : null,
        email:     m.publicUserData?.identifier ?? null,
      };
    });
    return NextResponse.json({ members, soloAccount: false });
  } catch (err) {
    console.error("[team] list failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load team" }, { status: 502 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!orgId)  return NextResponse.json({ error: "Create an organisation before inviting team members." }, { status: 400 });

  if ((await getAgencyRole()) !== "owner") {
    return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  }

  let body: { email?: string; role?: string };
  try {
    body = (await req.json()) as { email?: string; role?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = body.email?.trim();
  const role  = body.role && VALID_ROLES.has(body.role) ? body.role : "viewer";
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

  try {
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId:  userId,
      emailAddress:   email,
      role:           `org:${role}`,
    });
    return NextResponse.json({ success: true, email, role });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[team] invite failed:", msg);
    return NextResponse.json({ error: `Invite failed: ${msg}` }, { status: 502 });
  }
}
