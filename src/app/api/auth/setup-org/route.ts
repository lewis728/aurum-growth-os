/**
 * POST /api/auth/setup-org
 *
 * Auto-creates a Clerk organisation for a signed-in user who has no org yet.
 * Called once on first sign-in, before the onboarding flow.
 *
 * Flow:
 *   1. Authenticate the request (userId required, orgId must be null)
 *   2. Create a Clerk organisation named after the user's email domain
 *   3. Add the user as org:admin member
 *   4. Return the new orgId so the client can call setActive()
 */
import { NextRequest, NextResponse } from "next/server";
import { createClerkClient } from "@clerk/backend";
import { getServerAuth } from "@/lib/serverAuth";

export const dynamic = "force-dynamic";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId, orgId } = await getServerAuth(req);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // If user already has an org, just return it — idempotent
    if (orgId) {
      return NextResponse.json({ orgId, created: false });
    }

    // Fetch the user to get their name/email for the org name
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses?.[0]?.emailAddress ?? "";
    const firstName = user.firstName ?? "";
    const lastName = user.lastName ?? "";

    // Derive a sensible org name: "FirstName LastName's Agency" or domain-based
    let orgName: string;
    if (firstName || lastName) {
      orgName = `${[firstName, lastName].filter(Boolean).join(" ")}'s Agency`;
    } else if (email) {
      const domain = email.split("@")[1]?.split(".")[0] ?? "My";
      orgName = `${domain.charAt(0).toUpperCase() + domain.slice(1)} Agency`;
    } else {
      orgName = "My Agency";
    }

    // Create the organisation
    const org = await clerkClient.organizations.createOrganization({
      name: orgName,
      createdBy: userId,
    });

    // The createOrganization with createdBy already adds the user as admin,
    // but we explicitly ensure membership exists
    try {
      await clerkClient.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId,
        role: "org:admin",
      });
    } catch {
      // Membership may already exist from createOrganization — ignore duplicate errors
    }

    return NextResponse.json({ orgId: org.id, orgName: org.name, created: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[setup-org]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
