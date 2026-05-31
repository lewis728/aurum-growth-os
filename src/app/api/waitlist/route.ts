/**
 * POST /api/waitlist  (Sprint 16 — Marketing Website)
 * Public, unauthenticated endpoint for the marketing-site waitlist form.
 * Captures { name, email, agencyName?, clientCount? } into WaitlistEntry.
 *
 * Idempotent on email: a repeat signup updates the existing row rather than
 * erroring, so the visitor always sees success. Validates + length-caps input.
 * NEVER leaks internal errors to the public.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const name  = clean(body.name, 120);
  const email = clean(body.email, 200)?.toLowerCase() ?? null;
  if (!name || !email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A name and valid email are required." }, { status: 400 });
  }

  const agencyName  = clean(body.agencyName, 160);
  const clientCount = clean(body.clientCount, 40);
  const source      = clean(body.source, 80) ?? "marketing_site";

  try {
    await prisma.waitlistEntry.upsert({
      where:  { email },
      create: { name, email, agencyName, clientCount, source },
      update: { name, agencyName, clientCount },
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[waitlist] save failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not join the waitlist. Please try again." }, { status: 500 });
  }
}
