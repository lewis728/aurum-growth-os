/**
 * src/lib/services/calendarService.ts
 * SERVER-SIDE ONLY. Never import in "use client" files.
 *
 * Provider-abstracted calendar integration.
 *
 * Single public export:
 *   createCalendarEvent(appointmentId: string): Promise<void>
 *
 * Routing logic:
 *   GOOGLE   → POST to Google Calendar API v3 to create an event
 *   CALENDLY → Calendly manages bookings natively via its own flow;
 *              this path logs the event and returns (no API call needed)
 *
 * Non-fatal contract:
 *   If no CalendarConnection exists for the tenant, the function logs a
 *   warning and returns without throwing. The appointment is already in
 *   the DB — calendar sync is best-effort and must never block the booking.
 *
 * Adding future providers (Outlook, Acuity, etc.) requires:
 *   1. Add enum value to CalendarProvider in schema.prisma
 *   2. Add a case to the switch in createCalendarEvent()
 *   Zero changes needed in any caller.
 */

import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/services/metaAuthService";
import { CalendarProvider } from "@prisma/client";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoogleEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

interface GoogleEventResponse {
  id?: string;
  htmlLink?: string;
  error?: { message: string; code: number };
}

// ── Google Calendar ───────────────────────────────────────────────────────────

/**
 * Creates a Google Calendar event for the given appointment.
 * Assumes the access token is already valid (no refresh logic here —
 * token refresh is handled by the OAuth callback and a future cron job).
 */
async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleEventBody
): Promise<void> {
  const url = `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(event),
  });

  const data = (await res.json()) as GoogleEventResponse;

  if (!res.ok || data.error) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Google Calendar API error: ${msg}`);
  }

  console.log(
    `[calendarService] Google Calendar event created: ${data.htmlLink ?? data.id ?? "unknown"}`
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Creates a calendar event for the given appointment ID.
 *
 * Fetches the appointment, lead, and CalendarConnection from the DB.
 * Routes to the correct provider implementation.
 * Never throws — logs warnings and returns gracefully on any error.
 */
export async function createCalendarEvent(appointmentId: string): Promise<void> {
  // ── 1. Fetch appointment + lead ───────────────────────────────────────────
  let appointment: {
    id: string;
    tenantId: string;
    scheduledAt: Date;
    notes: string | null;
    lead: {
      firstName: string;
      lastName: string;
      phone: string;
      email: string | null;
    };
  } | null;

  try {
    appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        lead: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
      },
    });
  } catch (err) {
    console.warn(
      `[calendarService] DB error fetching appointment ${appointmentId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  if (!appointment) {
    console.warn(
      `[calendarService] Appointment ${appointmentId} not found — skipping calendar sync`
    );
    return;
  }

  const { tenantId, scheduledAt, notes, lead } = appointment;

  // ── 2. Fetch CalendarConnection ───────────────────────────────────────────
  let connection: {
    provider: CalendarProvider;
    encryptedToken: string;
    calendarId: string;
    expiresAt: Date | null;
  } | null;

  try {
    connection = await prisma.calendarConnection.findUnique({
      where: { tenantId },
      select: {
        provider: true,
        encryptedToken: true,
        calendarId: true,
        expiresAt: true,
      },
    });
  } catch (err) {
    console.warn(
      `[calendarService] DB error fetching CalendarConnection for tenant ${tenantId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  if (!connection) {
    console.warn(
      `[calendarService] No calendar connected for tenant ${tenantId} — ` +
      `appointment ${appointmentId} saved to DB but not synced to calendar`
    );
    return;
  }

  // ── 3. Check token expiry (Google only) ───────────────────────────────────
  if (
    connection.provider === CalendarProvider.GOOGLE &&
    connection.expiresAt &&
    connection.expiresAt < new Date()
  ) {
    console.warn(
      `[calendarService] Google Calendar token for tenant ${tenantId} has expired ` +
      `(expired at ${connection.expiresAt.toISOString()}) — ` +
      `appointment ${appointmentId} not synced. Tenant must reconnect.`
    );
    return;
  }

  // ── 4. Decrypt token ──────────────────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = decryptToken(connection.encryptedToken);
  } catch (err) {
    console.warn(
      `[calendarService] Token decryption failed for tenant ${tenantId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  // ── 5. Route to provider ──────────────────────────────────────────────────
  const leadName = `${lead.firstName} ${lead.lastName}`.trim();
  const startTime = scheduledAt;
  const endTime = new Date(scheduledAt.getTime() + 60 * 60 * 1000); // 1-hour default duration

  const description = [
    `Client: ${leadName}`,
    `Phone: ${lead.phone}`,
    lead.email ? `Email: ${lead.email}` : null,
    notes ? `Notes: ${notes}` : null,
    `Appointment ID: ${appointmentId}`,
    `Booked via Aurum Growth OS`,
  ]
    .filter(Boolean)
    .join("\n");

  switch (connection.provider) {
    case CalendarProvider.GOOGLE: {
      try {
        await createGoogleCalendarEvent(
          accessToken,
          connection.calendarId,
          {
            summary: `Consultation — ${leadName}`,
            description,
            start: {
              dateTime: startTime.toISOString(),
              timeZone: "Europe/London",
            },
            end: {
              dateTime: endTime.toISOString(),
              timeZone: "Europe/London",
            },
          }
        );
      } catch (err) {
        console.warn(
          `[calendarService] Google Calendar event creation failed for appointment ${appointmentId}:`,
          err instanceof Error ? err.message : String(err)
        );
        // Non-fatal — appointment is already in DB
      }
      break;
    }

    case CalendarProvider.CALENDLY: {
      // Calendly manages bookings natively through its own scheduling flow.
      // When a lead books via Calendly, the inbound webhook at
      // /api/webhooks/calendly handles the sync back into Aurum DB.
      // This path is reached when an appointment is created via the Retell
      // webhook — we log it for audit purposes but no API call is needed.
      console.log(
        `[calendarService] Calendly provider — appointment ${appointmentId} ` +
        `for tenant ${tenantId} logged. Calendly manages its own booking flow.`
      );
      break;
    }

    default: {
      // Exhaustive check — TypeScript will flag unhandled providers at compile time
      const _exhaustive: never = connection.provider;
      console.warn(
        `[calendarService] Unknown provider "${String(_exhaustive)}" for tenant ${tenantId}`
      );
    }
  }
}

// ── Connection Status ─────────────────────────────────────────────────────────

export type CalendarConnectionStatus =
  | { connected: false; reason: "not_connected" }
  | { connected: false; reason: "expired"; expiredAt: Date }
  | {
      connected: true;
      provider: CalendarProvider;
      calendarId: string;
      connectedAt: Date;
      expiresAt: Date | null;
    };

/**
 * Returns a typed status object for the tenant's calendar connection.
 * Safe to return to the client — no tokens included.
 */
export async function getCalendarConnectionStatus(
  tenantId: string
): Promise<CalendarConnectionStatus> {
  const connection = await prisma.calendarConnection.findUnique({
    where: { tenantId },
    select: {
      provider: true,
      calendarId: true,
      connectedAt: true,
      expiresAt: true,
    },
  });

  if (!connection) {
    return { connected: false, reason: "not_connected" };
  }

  if (connection.expiresAt && connection.expiresAt < new Date()) {
    return { connected: false, reason: "expired", expiredAt: connection.expiresAt };
  }

  return {
    connected: true,
    provider: connection.provider,
    calendarId: connection.calendarId,
    connectedAt: connection.connectedAt,
    expiresAt: connection.expiresAt,
  };
}
