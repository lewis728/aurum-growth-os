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
export async function createCalendarEvent(
  appointmentId: string,
  contractorIdOverride?: string | null,
): Promise<void> {
  // ── 1. Fetch appointment + lead + the booking's contractor link ───────────
  let appointment: {
    id: string;
    tenantId: string;
    scheduledAt: Date;
    notes: string | null;
    blueprint: { contractorId: string | null } | null;
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
        blueprint: { select: { contractorId: true } },
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

  // ── 2. Resolve the target calendar: the booking's CONTRACTOR first (explicit
  //       override → blueprint's contractor), else the tenant-level (Lewis's own)
  //       connection as a fallback so a booking is never lost.
  const targetContractorId = contractorIdOverride ?? appointment.blueprint?.contractorId ?? null;

  const connSelect = {
    provider: true,
    encryptedToken: true,
    calendarId: true,
    expiresAt: true,
    timeZone: true,
  } as const;

  let connection: {
    provider: CalendarProvider;
    encryptedToken: string;
    calendarId: string;
    expiresAt: Date | null;
    timeZone: string | null;
  } | null = null;

  try {
    if (targetContractorId) {
      connection = await prisma.calendarConnection.findUnique({
        where: { contractorId: targetContractorId },
        select: connSelect,
      });
    }
    if (!connection) {
      connection = await prisma.calendarConnection.findFirst({
        where: { tenantId, contractorId: null },
        select: connSelect,
      });
    }
  } catch (err) {
    console.warn(
      `[calendarService] DB error fetching CalendarConnection for tenant ${tenantId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  if (!connection) {
    console.warn(
      `[calendarService] No calendar connected (contractor ${targetContractorId ?? "none"}, tenant ${tenantId}) — ` +
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
  // The dateTime is an absolute UTC instant (toISOString), so the event fires at
  // the correct moment regardless; this label controls how Google DISPLAYS it.
  // Use the connection's captured tz, default UTC — never assume London.
  const eventTimeZone = connection.timeZone ?? "UTC";

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
              timeZone: eventTimeZone,
            },
            end: {
              dateTime: endTime.toISOString(),
              timeZone: eventTimeZone,
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
  const connection = await prisma.calendarConnection.findFirst({
    where: { tenantId, contractorId: null },
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

// ── Contractor availability (for availability-aware booking) ────────────────────

export interface AvailableSlot {
  start: Date;
  label: string; // human, in the contractor's timezone, e.g. "Tuesday 10 Jun, 10:00"
}

/**
 * Reads the contractor's connected Google Calendar and returns the next open
 * business-hours slots (Mon–Fri, 09:00–17:00 in their timezone, 1-hour slots,
 * minus anything already busy). Sophie offers ONLY these on the call so we never
 * book a time the contractor isn't free for.
 *
 * NEVER THROWS — returns [] when there's no Google calendar connected, the token
 * is expired, or anything errors, so the caller falls back to open-ended booking.
 * Google only (Calendly manages its own availability).
 */
export async function getContractorAvailableSlots(
  contractorId: string,
  opts?: { days?: number; maxSlots?: number; slotMinutes?: number },
): Promise<AvailableSlot[]> {
  const days = opts?.days ?? 10;
  const maxSlots = opts?.maxSlots ?? 8;
  const slotMinutes = opts?.slotMinutes ?? 60;

  try {
    const conn = await prisma.calendarConnection.findUnique({
      where: { contractorId },
      select: { provider: true, encryptedToken: true, calendarId: true, expiresAt: true, timeZone: true },
    });
    if (!conn || conn.provider !== CalendarProvider.GOOGLE) return [];
    if (conn.expiresAt && conn.expiresAt < new Date()) return [];

    let token: string;
    try {
      token = decryptToken(conn.encryptedToken);
    } catch {
      return [];
    }

    const now = new Date();
    const timeMin = new Date(now.getTime() + 60 * 60 * 1000); // at least 1h out
    const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const res = await fetch(`${GOOGLE_CALENDAR_API_BASE}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: conn.calendarId }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };
    const busy = (data.calendars?.[conn.calendarId]?.busy ?? []).map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
    }));

    // Business-hours window evaluated in the contractor's own timezone (default UK).
    const tz = conn.timeZone ?? "Europe/London";
    const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" });
    const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false });
    const labelFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

    const slots: AvailableSlot[] = [];
    const cursor = new Date(timeMin);
    cursor.setMinutes(0, 0, 0);
    cursor.setHours(cursor.getHours() + 1); // start on the next full hour

    for (let i = 0; i < days * 24 && slots.length < maxSlots; i++) {
      const weekday = weekdayFmt.format(cursor);
      const localHour = parseInt(hourFmt.format(cursor), 10);
      if (WEEKDAYS.has(weekday) && localHour >= 9 && localHour <= 16 && cursor > now) {
        const slotEnd = new Date(cursor.getTime() + slotMinutes * 60 * 1000);
        const clash = busy.some((b) => cursor < b.end && slotEnd > b.start);
        if (!clash) slots.push({ start: new Date(cursor), label: labelFmt.format(cursor) });
      }
      cursor.setHours(cursor.getHours() + 1);
    }

    return slots;
  } catch (err) {
    console.warn(
      `[calendarService] availability read failed for contractor ${contractorId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
