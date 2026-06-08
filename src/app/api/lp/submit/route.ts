/**
 * POST /api/lp/submit
 * Public endpoint the landing-page form posts to. Validates the fields, signs the
 * payload SERVER-SIDE with LEAD_WEBHOOK_SECRET (the secret must never reach the
 * browser), and forwards to the leads webhook with the x-aurum-signature header.
 *
 * B2C roofing form: name + phone are required; email is OPTIONAL (the leads webhook
 * treats it as optional too). The roof issue + postcode ride in formData so they
 * reach the lead row and the roofer's handoff SMS (roofIssueFrom reads formData.roofIssue).
 *
 * Returns { success: true, leadId } or { error }.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

interface SubmitBody {
  blueprintId?:          string;
  name?:                 string; // full name (preferred — single field)
  firstName?:            string;
  lastName?:             string;
  phone?:                string;
  email?:                string; // optional
  roofIssue?:            string;
  postcode?:             string;
  qualificationAnswers?: Record<string, string>;
  fillDurationMs?:       number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[lp/submit] LEAD_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const blueprintId = body.blueprintId?.trim();
  const name        = body.name?.trim();
  const firstName   = body.firstName?.trim();
  const lastName    = body.lastName?.trim();
  const phone       = body.phone?.trim();
  const email       = body.email?.trim();
  const roofIssue   = body.roofIssue?.trim();
  const postcode    = body.postcode?.trim();

  if (!blueprintId) return NextResponse.json({ error: "Missing campaign reference." }, { status: 400 });
  const hasName = Boolean(name || (firstName && lastName) || firstName);
  if (!hasName) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!phone || phone.replace(/\D/g, "").length < 7) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }

  // Name fields the leads webhook understands (it can split a fullName itself).
  const nameFields = name
    ? { fullName: name }
    : firstName && lastName
      ? { firstName, lastName }
      : { fullName: firstName };

  // Build the EXACT body we sign and send (re-stringifying differently breaks HMAC).
  const payload = JSON.stringify({
    ...nameFields,
    phone,
    ...(email ? { email } : {}),
    formData: {
      source:    "landing_page",
      ...(roofIssue ? { roofIssue } : {}),
      ...(postcode ? { postcode } : {}),
      qualificationAnswers: body.qualificationAnswers ?? {},
      ...(typeof body.fillDurationMs === "number" ? { fillDurationMs: body.fillDurationMs } : {}),
    },
  });

  const signature  = `sha256=${crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
  const webhookUrl = `${req.nextUrl.origin}/api/webhooks/leads/${encodeURIComponent(blueprintId)}`;

  try {
    const res  = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-aurum-signature": signature },
      body:    payload,
    });
    const data = (await res.json().catch(() => ({}))) as { leadId?: string; error?: string };

    if (!res.ok) {
      console.error("[lp/submit] webhook rejected:", res.status, data.error);
      // Don't leak internal reasons (401/404 etc.) to the public form.
      return NextResponse.json({ error: "We couldn't submit your details. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ success: true, leadId: data.leadId });
  } catch (err) {
    console.error("[lp/submit] forward failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "We couldn't submit your details. Please try again." }, { status: 502 });
  }
}
