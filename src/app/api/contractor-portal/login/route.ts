/**
 * POST /api/contractor-portal/login  — PUBLIC
 * Body: { email }. Emails the contractor a signed magic link to their dashboard.
 * Always responds { ok: true } (never reveals whether an email is registered).
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { contractorPortalUrl } from "@/lib/contractorToken";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = body.email?.trim();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const contractor = await prisma.contractor.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  });

  if (contractor) {
    const link = contractorPortalUrl(req.nextUrl.origin, contractor.id);
    const key = process.env.RESEND_API_KEY;
    const from = process.env.FROM_EMAIL;
    try {
      if (key && from) {
        await new Resend(key).emails.send({
          from: `Aurum <${from}>`,
          to: contractor.email,
          subject: "Your Aurum dashboard link",
          html:
            `<p>Hi ${contractor.name},</p>` +
            `<p>Here's your secure dashboard link (valid 30 days):</p>` +
            `<p><a href="${link}">Open my dashboard</a></p>`,
        });
      } else {
        console.warn(`[contractor-portal/login] email not configured — link for ${contractor.id}: ${link}`);
      }
    } catch (e) {
      console.error("[contractor-portal/login] send failed:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ ok: true });
}
