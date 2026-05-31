/**
 * src/app/api/agency/notifications/route.ts
 * GET   — returns the tenant's notification settings (Slack webhook configured?).
 * PATCH — sets or clears the agency's Slack Incoming Webhook URL.
 *
 * The webhook URL is a secret (anyone with it can post to the channel), so GET
 * never returns the raw URL — only whether one is configured. Tenant-scoped via
 * the canonical auth pattern.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { notifySlack } from "@/lib/services/alertService";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  // Either a valid Slack webhook, or "" / null to clear it.
  slackWebhookUrl: z
    .string()
    .url()
    .regex(/^https:\/\/hooks\.slack\.com\//, "Must be a Slack Incoming Webhook URL")
    .nullable()
    .or(z.literal("")),
  // When true, send a test message to confirm the webhook works before saving.
  test: z.boolean().optional(),
});

export async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  const agency = await prisma.agencyProfile.findUnique({
    where:  { tenantId },
    select: { slackWebhookUrl: true },
  });

  return NextResponse.json({ slackConfigured: Boolean(agency?.slackWebhookUrl) });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const tenantId = orgId ?? `pending:${userId}`;

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await req.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.issues[0]?.message ?? "Invalid input" : "Invalid JSON";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const url = body.slackWebhookUrl ? body.slackWebhookUrl : null;

  // Must have an AgencyProfile to attach the setting to.
  const agency = await prisma.agencyProfile.findUnique({ where: { tenantId }, select: { id: true } });
  if (!agency) {
    return NextResponse.json({ error: "No agency profile found — complete onboarding first." }, { status: 404 });
  }

  // Optional: verify the webhook actually delivers before persisting.
  if (body.test && url) {
    const ok = await notifySlack(url, {
      agentName:   "Aurum",
      clientName:  "Test notification",
      actionType:  "NEEDS_APPROVAL",
      issue:       "Your Slack notifications are connected. This is a test alert — your AI team will message here when something needs you.",
      recommended: "No action needed.",
      blueprintId: null,
    });
    if (!ok) {
      return NextResponse.json(
        { error: "Slack rejected the test message. Check the webhook URL is correct and active." },
        { status: 422 },
      );
    }
  }

  await prisma.agencyProfile.update({
    where: { tenantId },
    data:  { slackWebhookUrl: url },
  });

  return NextResponse.json({ slackConfigured: Boolean(url), tested: Boolean(body.test && url) });
}
