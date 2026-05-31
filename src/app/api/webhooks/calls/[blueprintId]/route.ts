/**
 * src/app/api/webhooks/calls/[blueprintId]/route.ts
 * POST /api/webhooks/calls/:blueprintId
 * PUBLIC — No Clerk auth required. Called by Retell voice AI after a call.
 *
 * Thin transport edge: verify the HMAC signature, parse, and delegate ALL
 * post-call logic to the SCHEDULER role (src/lib/agents/roles/scheduler.ts).
 * The Caller hands off to the Scheduler purely through this webhook — DB-only,
 * no direct call between roles.
 *
 * Processing is AWAITED before responding: on Vercel serverless the function is
 * frozen once the response returns, so deferred work would silently never run.
 * handleCallOutcome never throws and returns fast (a few DB writes + one SMS +
 * a GPT objection extraction) — well within Retell's timeout.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { handleCallOutcome, type RetellCallAnalysis } from "@/lib/agents/roles/scheduler";

export const dynamic = "force-dynamic";

// ── HMAC validation ───────────────────────────────────────────────────────────
function validateRetellSignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.RETELL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[calls webhook] RETELL_WEBHOOK_SECRET is not configured.");
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { blueprintId: string } },
): Promise<NextResponse> {
  const { blueprintId } = params;

  // 1. Read raw body BEFORE parsing (signature is over the exact bytes).
  const rawBody = await req.text();

  // 2. Validate HMAC signature.
  const signatureHeader = req.headers.get("x-retell-signature") ?? "";
  if (!validateRetellSignature(rawBody, signatureHeader)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Parse.
  let payload: RetellCallAnalysis;
  try {
    payload = JSON.parse(rawBody) as RetellCallAnalysis;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // 4. Delegate to the Scheduler — it owns everything from here and never throws.
  const result = await handleCallOutcome(blueprintId, payload);
  return NextResponse.json(result.body, { status: result.status });
}
