/**
 * POST /api/contractors/onboard
 * PUBLIC — no auth. Drives the self-serve contractor onboarding at
 * /onboard/contractor: creates a PENDING contractor under the operator's tenant
 * and returns the £700 lock-in Stripe Checkout URL. The contractor stays inert
 * (status "pending", no routing) until the lock-in clears (Stripe webhook flips
 * them to "active" + grants prepaid credits), so a public create is harmless.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startContractorLockIn } from "@/lib/services/contractorBillingService";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_VERTICALS = new Set(["roofing", "home_improvement"]);

interface OnboardBody {
  name: string;
  companyName?: string;
  phone?: string;
  email: string;
  city: string;
  vertical?: string;
}

/** The single operator (Lewis) owns every contractor. */
async function resolveOperatorTenantId(): Promise<string | null> {
  if (process.env.OPERATOR_TENANT_ID) return process.env.OPERATOR_TENANT_ID;
  const profile = await prisma.agencyProfile.findFirst({
    select: { tenantId: true },
    orderBy: { createdAt: "asc" },
  });
  return profile?.tenantId ?? null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: OnboardBody;
  try {
    body = (await req.json()) as OnboardBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) return NextResponse.json({ error: "Your name is required" }, { status: 400 });
  if (!body.city?.trim()) return NextResponse.json({ error: "Your city / territory is required" }, { status: 400 });
  if (!body.email?.trim() || !EMAIL_RE.test(body.email.trim())) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  const vertical = body.vertical && VALID_VERTICALS.has(body.vertical) ? body.vertical : "roofing";

  const tenantId = await resolveOperatorTenantId();
  if (!tenantId) {
    console.error("[contractors/onboard] no operator tenant configured");
    return NextResponse.json({ error: "Onboarding is not configured yet. Please contact us." }, { status: 503 });
  }

  const contractor = await prisma.contractor.create({
    data: {
      tenantId,
      name: body.name.trim(),
      companyName: body.companyName?.trim() || null,
      city: body.city.trim(),
      vertical,
      email: body.email.trim(),
      phone: body.phone?.trim() || null,
      status: "pending",
    },
  });

  const origin = req.nextUrl.origin;
  try {
    const checkoutUrl = await startContractorLockIn(contractor.id, {
      successUrl: `${origin}/onboard/contractor?paid=1&contractorId=${contractor.id}`,
      cancelUrl: `${origin}/onboard/contractor?cancelled=1&contractorId=${contractor.id}`,
    });
    return NextResponse.json({ contractorId: contractor.id, checkoutUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[contractors/onboard] checkout failed:", message);
    // The contractor row exists (pending); surface a clean error to the UI.
    return NextResponse.json({ error: "Could not start payment. Please try again." }, { status: 502 });
  }
}
