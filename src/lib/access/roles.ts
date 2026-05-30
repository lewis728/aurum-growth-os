/**
 * src/lib/access/roles.ts
 * SERVER-SIDE role helpers for Clerk organisation membership.
 *
 * Roles (stored as Clerk org roles): owner | manager | viewer.
 * Clerk exposes the active membership role on auth().orgRole as "org:<role>".
 *
 * Backward-compat rule: a user with NO active org (solo / pending:userId) is
 * treated as "owner" so existing single-user accounts keep full access. We only
 * restrict when a real org role is present and it is not owner.
 */
import { auth } from "@clerk/nextjs/server";

export type AgencyRole = "owner" | "manager" | "viewer";

/** Clerk's built-in admin role maps to owner for our purposes. */
function normaliseRole(raw: string | null | undefined): AgencyRole | null {
  if (!raw) return null;
  const r = raw.replace(/^org:/, "").toLowerCase();
  if (r === "owner" || r === "admin") return "owner";
  if (r === "manager") return "manager";
  if (r === "viewer" || r === "member") return "viewer";
  return null;
}

/**
 * Returns the caller's agency role. Defaults to "owner" when there is no active
 * org membership (solo user) so pre-org flows are never locked out.
 */
export async function getAgencyRole(): Promise<AgencyRole> {
  const { orgId, orgRole } = await auth();
  if (!orgId) return "owner";
  return normaliseRole(orgRole) ?? "viewer";
}

export async function isOwner(): Promise<boolean> {
  return (await getAgencyRole()) === "owner";
}
