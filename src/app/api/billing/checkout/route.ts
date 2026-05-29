/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for the agency owner.
 * Returns { url } — frontend opens in a new tab.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getTenantId } from "@/lib/auth";
import {
  createOrRetrieveCustomer,
  createCheckoutSession,
} from "@/lib/services/stripeService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "No organisation found" }, { status: 400 });
  }

  try {
    // Fetch org name and user email from Clerk
    const [org, user] = await Promise.all([
      clerkClient.organizations.getOrganization({ organizationId: tenantId }),
      clerkClient.users.getUser(userId),
    ]);

    const email = user.emailAddresses[0]?.emailAddress ?? "";
    const orgName = org.name;

    const origin = req.headers.get("origin") ?? "https://aurumgrowth.ai";
    const successUrl = `${origin}/billing?success=true`;
    const cancelUrl = `${origin}/billing?canceled=true`;

    const customerId = await createOrRetrieveCustomer(tenantId, email, orgName);
    const url = await createCheckoutSession(tenantId, customerId, successUrl, cancelUrl);

    return NextResponse.json({ url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/checkout] Error:", message);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
