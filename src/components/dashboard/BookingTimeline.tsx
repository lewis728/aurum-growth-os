"use client";
/**
 * src/components/dashboard/BookingTimeline.tsx
 *
 * Shows upcoming (and recent past) appointments across the agency's client
 * portfolio. Each row shows: slot time, lead name, client name, status badge,
 * and three reminder dots (confirmation / day before / hour before).
 */
import type { BookingRow } from "@/app/api/dashboard/metrics/route";

interface BookingTimelineProps {
  bookings:  BookingRow[];
  isLoading: boolean;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  confirmed:  { label: "Confirmed",  className: "bg-emerald-100 text-emerald-700" },
  pending:    { label: "Pending",    className: "bg-amber-100 text-amber-700" },
  cancelled:  { label: "Cancelled", className: "bg-red-100 text-red-500" },
  completed:  { label: "Completed", className: "bg-blue-100 text-blue-700" },
  no_show:    { label: "No Show",   className: "bg-slate-100 text-slate-500" },
};

function formatSlot(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day:     "numeric",
    month:   "short",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour:   "2-digit",
    minute: "2-digit",
  });
  return { date, time };
}

function ReminderDot({ sent, label }: { sent: boolean; label: string }) {
  return (
    <span
      title={label}
      className={`
        inline-block w-2 h-2 rounded-full
        ${sent ? "bg-[#C9A84C]" : "bg-[#E5E7EB]"}
      `}
    />
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-[#F3F4F6] animate-pulse">
      <div className="w-14 flex-shrink-0">
        <div className="h-3 w-10 bg-[#F3F4F6] rounded mb-1" />
        <div className="h-4 w-12 bg-[#F3F4F6] rounded" />
      </div>
      <div className="flex-1">
        <div className="h-3 w-28 bg-[#F3F4F6] rounded mb-1.5" />
        <div className="h-2.5 w-20 bg-[#F3F4F6] rounded" />
      </div>
      <div className="h-5 w-16 bg-[#F3F4F6] rounded-full" />
    </div>
  );
}

export function BookingTimeline({ bookings, isLoading }: BookingTimelineProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
        <h2 className="text-sm font-semibold text-[#111827]">Client Bookings</h2>
        <span className="text-xs text-[#6B7280]">Next 7 days + recent · all clients</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[#F3F4F6]">
        {isLoading && bookings.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
        ) : bookings.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[#6B7280]">No bookings yet.</p>
            <p className="text-xs text-[#9CA3AF] mt-1">
              Appointments booked through your client campaigns will appear here.
            </p>
          </div>
        ) : (
          bookings.map((booking) => {
            const { date, time } = formatSlot(booking.slotTime);
            const badge =
              STATUS_BADGE[booking.status] ??
              { label: booking.status, className: "bg-slate-100 text-slate-500" };
            const isPast = new Date(booking.slotTime) < new Date();

            return (
              <div
                key={booking.appointmentId}
                className={`
                  flex items-center gap-4 px-6 py-3
                  hover:bg-[#FAFAFA] transition-colors
                  ${isPast ? "opacity-60" : ""}
                `}
              >
                {/* Date/time column */}
                <div className="w-16 flex-shrink-0 text-right">
                  <p className="text-xs text-[#6B7280]">{date}</p>
                  <p className="text-sm font-semibold text-[#111827]">{time}</p>
                </div>

                {/* Lead + client info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#111827] truncate">
                    {booking.leadName}
                  </p>
                  <p className="text-xs text-[#6B7280] truncate">
                    {booking.clientName}
                  </p>
                </div>

                {/* Reminder dots */}
                <div className="flex items-center gap-1.5 flex-shrink-0" title="Reminders sent">
                  <ReminderDot sent={booking.remindersSent.confirmation} label="Confirmation" />
                  <ReminderDot sent={booking.remindersSent.dayBefore}    label="Day before" />
                  <ReminderDot sent={booking.remindersSent.hourBefore}   label="Hour before" />
                </div>

                {/* Status badge */}
                <span
                  className={`
                    inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                    flex-shrink-0
                    ${badge.className}
                  `}
                >
                  {badge.label}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
