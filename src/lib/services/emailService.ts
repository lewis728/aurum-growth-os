// src/lib/services/emailService.ts
// Transactional email service using the Resend SDK.
// All exported functions NEVER throw — errors are caught, logged to CommandLog,
// and the function returns silently.

import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/services/brandingService";

// ── Resend client (lazy-initialised to avoid build-time errors) ────────────────
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return new Resend(key);
}

function getFromEmail(): string {
  const addr = process.env.FROM_EMAIL;
  if (!addr) throw new Error("FROM_EMAIL is not set");
  return addr;
}

// ── Month name helper ─────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthName(month: number): string {
  return MONTH_NAMES[(month - 1) % 12] ?? String(month);
}

// ── logFailure ────────────────────────────────────────────────────────────────
async function logFailure(
  tenantId: string,
  intentType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.commandLog.create({
      data: {
        tenantId,
        rawInput: `emailService:${intentType}`,
        intentType,
        success: false,
        errorMsg: JSON.stringify(payload),
      },
    });
  } catch {
    // CommandLog write failure is non-fatal
  }
}

// ── sendMonthlyReport ─────────────────────────────────────────────────────────
/**
 * Sends the monthly performance report HTML to the agency owner.
 * On success, updates MonthlyReport.emailedAt.
 * On failure, logs to CommandLog and returns silently.
 */
export async function sendMonthlyReport(
  tenantId: string,
  reportHtml: string,
  recipientEmail: string,
  month: number,
  year: number
): Promise<void> {
  try {
    const branding = await getBranding(tenantId);
    // Prefer the explicit sender name, then the white-label agency name, before
    // falling back to the platform brand.
    const fromName = branding?.fromName ?? branding?.agencyName ?? "Aurum Growth OS";
    const fromEmail = getFromEmail();
    const subject = `Your ${monthName(month)} ${year} Performance Report — ${fromName}`;

    const resend = getResend();
    const { error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to:   recipientEmail,
      subject,
      html: reportHtml,
    });

    if (error) {
      throw new Error(error.message ?? "Resend API error");
    }

    // Update emailedAt on success
    await prisma.monthlyReport.updateMany({
      where: { tenantId, month, year },
      data:  { emailedAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[emailService.sendMonthlyReport] tenantId=${tenantId} month=${month}/${year}: ${message}`);
    await logFailure(tenantId, "EMAIL_FAILED", { tenantId, month, year, error: message });
  }
}

// ── sendClientReport ──────────────────────────────────────────────────────────
/**
 * Sends a client-facing monthly report to the agency's CLIENT (not the owner),
 * fully white-labelled under the agency's brand — zero Aurum mention. Used for the
 * per-client ROI report. NEVER throws. Does NOT touch MonthlyReport.emailedAt
 * (that row is the tenant-level aggregate, emailed separately to the owner).
 *
 * @param tenantId       agency tenant (for branding lookup + failure logging)
 * @param reportHtml     client-facing HTML (single campaign, revenue/ROI story)
 * @param clientEmail    ClientBrief.clientContactEmail
 * @param businessName   the client's business name (subject line)
 */
export async function sendClientReport(
  tenantId: string,
  reportHtml: string,
  clientEmail: string,
  businessName: string,
  month: number,
  year: number
): Promise<boolean> {
  try {
    const branding = await getBranding(tenantId);
    // White-label: sender is the AGENCY, never the platform. Fall back to a
    // neutral name (never "Aurum") so a misconfigured agency can't leak our brand
    // to their client.
    const fromName  = branding?.fromName ?? branding?.agencyName ?? "Your Marketing Team";
    const fromEmail = getFromEmail();
    const replyTo   = branding?.supportEmail ?? undefined;
    const subject   = `${businessName} — Your ${monthName(month)} ${year} Results`;

    const resend = getResend();
    const { error } = await resend.emails.send({
      from:    `${fromName} <${fromEmail}>`,
      to:      clientEmail,
      subject,
      html:    reportHtml,
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) throw new Error(error.message ?? "Resend API error");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[emailService.sendClientReport] tenantId=${tenantId} ${month}/${year} -> ${clientEmail}: ${message}`);
    await logFailure(tenantId, "CLIENT_REPORT_EMAIL_FAILED", { tenantId, month, year, clientEmail, error: message });
    return false;
  }
}

// ── sendPaymentFailedAlert ────────────────────────────────────────────────────
/**
 * Sends a payment-failed transactional alert to the agency owner.
 * NEVER throws.
 */
export async function sendPaymentFailedAlert(
  recipientEmail: string,
  portalUrl: string
): Promise<void> {
  try {
    const fromEmail = getFromEmail();
    const resend = getResend();

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#FFFFFF;color:#111827;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;">
    <h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:16px;">
      Action required — payment failed
    </h2>
    <p style="font-size:15px;line-height:1.6;color:#374151;margin-bottom:16px;">
      We were unable to process your latest payment. To keep your account active and
      your client campaigns running, please update your billing details as soon as possible.
    </p>
    <a href="${portalUrl}"
       style="display:inline-block;background:#C9A84C;color:#FFFFFF;font-weight:600;
              font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;
              margin-bottom:24px;">
      Update Billing Details
    </a>
    <p style="font-size:13px;color:#6B7280;">
      If you have any questions, reply to this email and we will help you right away.
    </p>
  </div>
</body>
</html>`;

    const { error } = await resend.emails.send({
      from:    `Aurum Growth OS <${fromEmail}>`,
      to:      recipientEmail,
      subject: "Action required — payment failed",
      html,
    });

    if (error) {
      throw new Error(error.message ?? "Resend API error");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[emailService.sendPaymentFailedAlert] to=${recipientEmail}: ${message}`);
    // No tenantId available here — log without it
    try {
      await prisma.commandLog.create({
        data: {
          tenantId:  "system",
          rawInput:  `emailService:PAYMENT_FAILED_ALERT:${recipientEmail}`,
          intentType: "EMAIL_FAILED",
          success:   false,
          errorMsg:  message,
        },
      });
    } catch {
      // Non-fatal
    }
  }
}
