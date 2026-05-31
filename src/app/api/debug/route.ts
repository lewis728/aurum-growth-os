import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMP debug: reports which env vars the running deployment can see.
// Returns booleans + lengths ONLY — never the values. Gated behind CRON_SECRET.
// Remove after diagnosing the Retell env issue.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: true, ts: new Date().toISOString() });
  }

  const seen = (k: string) => {
    const v = process.env[k];
    return { present: typeof v === "string" && v.length > 0, length: v ? v.length : 0 };
  };

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      RETELL_FROM_NUMBER:    seen("RETELL_FROM_NUMBER"),
      RETELL_API_KEY:        seen("RETELL_API_KEY"),
      RETELL_AGENT_ID:       seen("RETELL_AGENT_ID"),
      RETELL_WEBHOOK_SECRET: seen("RETELL_WEBHOOK_SECRET"),
      LEAD_WEBHOOK_SECRET:   seen("LEAD_WEBHOOK_SECRET"),
      TWILIO_FROM_NUMBER:    seen("TWILIO_FROM_NUMBER"),
      TWILIO_ACCOUNT_SID:    seen("TWILIO_ACCOUNT_SID"),
    },
  });
}
