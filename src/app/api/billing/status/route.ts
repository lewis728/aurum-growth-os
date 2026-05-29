/**
 * GET /api/billing/status - DEBUG VERSION
 */
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(): Promise<NextResponse> {
  try {
    const { auth } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized", step: "auth" }, { status: 401 });
    }
    return NextResponse.json({ ok: true, userId: userId.slice(0, 8) + "..." });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack?.slice(0, 300) : "";
    return NextResponse.json({ error: msg, stack, step: "catch" }, { status: 500 });
  }
}
