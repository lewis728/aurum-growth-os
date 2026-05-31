/**
 * src/lib/services/smsTemplates.ts
 * SERVER-SIDE-safe (pure data + helpers) — editable SMS templates (Sprint 3D).
 *
 * The agency owner edits these per client in the dashboard; they're stored on
 * ClientBrief.smsTemplates and read at SEND time. Variables are interpolated with
 * real lead data: {{lead_first_name}}, {{business_name}}, {{appointment_time}},
 * {{agent_name}}. If a field is blank, the vertical default (then the generic
 * default) is used — so a client always has a usable message.
 */

export const SMS_TEMPLATE_KEYS = [
  "bookedConfirmation", "dayBefore", "hourBefore", "qualifiedNudge", "noShow",
] as const;
export type SmsTemplateKey = (typeof SMS_TEMPLATE_KEYS)[number];

export type SmsTemplates = Partial<Record<SmsTemplateKey, string>>;

export const SMS_TEMPLATE_LABELS: Record<SmsTemplateKey, string> = {
  bookedConfirmation: "Booking confirmation",
  dayBefore:          "Day-before reminder",
  hourBefore:         "Hour-before reminder",
  qualifiedNudge:     "Qualified-but-not-booked nudge",
  noShow:             "No-show follow-up",
};

// Generic defaults — the always-available fallback. {{...}} vars filled at send.
const GENERIC: Required<Record<SmsTemplateKey, string>> = {
  bookedConfirmation: "Hi {{lead_first_name}}, great speaking with you! Your appointment with {{business_name}} is confirmed for {{appointment_time}}. See you then.",
  dayBefore:          "Hi {{lead_first_name}}, a reminder that your appointment with {{business_name}} is tomorrow at {{appointment_time}}. Reply STOP to cancel.",
  hourBefore:         "Hi {{lead_first_name}}, your appointment with {{business_name}} is in 1 hour. We look forward to seeing you.",
  qualifiedNudge:     "Hi {{lead_first_name}}, {{business_name}} would love to help — reply here to book your free consultation.",
  noShow:             "Hi {{lead_first_name}}, we missed you for your appointment with {{business_name}} today. Want to rebook?",
};

// Per-vertical default overrides. Only keys that differ from GENERIC are listed;
// the rest fall through to GENERIC. New clients are seeded from these.
const VERTICAL_DEFAULTS: Record<string, SmsTemplates> = {
  aesthetics: {
    bookedConfirmation: "Hi {{lead_first_name}}, lovely speaking with you! Your complimentary consultation at {{business_name}} is confirmed for {{appointment_time}}. We look forward to seeing you ✨",
    dayBefore:          "Hi {{lead_first_name}}, just a reminder your consultation at {{business_name}} is tomorrow at {{appointment_time}}. Reply CONFIRM to confirm or CANCEL to reschedule.",
  },
  roofing: {
    bookedConfirmation: "Hi {{lead_first_name}}, great speaking with you! Your free roof survey with {{business_name}} is booked for {{appointment_time}}. Our surveyor will be with you then.",
  },
  home_services: {
    bookedConfirmation: "Hi {{lead_first_name}}, thanks for your time! Your free quote visit from {{business_name}} is booked for {{appointment_time}}. See you then.",
  },
  personal_injury: {
    bookedConfirmation: "Hi {{lead_first_name}}, thank you for speaking with us. Your free consultation with {{business_name}} is confirmed for {{appointment_time}}. Our team will be in touch shortly.",
  },
  dental: {
    bookedConfirmation: "Hi {{lead_first_name}}, thanks for booking! Your consultation at {{business_name}} is confirmed for {{appointment_time}}. We look forward to seeing your smile.",
  },
  legal: {
    bookedConfirmation: "Hi {{lead_first_name}}, thank you for getting in touch. Your consultation with {{business_name}} is confirmed for {{appointment_time}}. Our team will be ready for you.",
  },
};

/** The default template set for a vertical (vertical overrides merged over generic). */
export function defaultTemplatesForVertical(vertical: string | null | undefined): Required<Record<SmsTemplateKey, string>> {
  const v = (vertical ?? "").toLowerCase();
  const overrides = VERTICAL_DEFAULTS[v] ?? {};
  return { ...GENERIC, ...overrides };
}

/**
 * Resolves one template: owner override (if non-empty) → vertical default →
 * generic. Always returns a usable string.
 */
export function resolveTemplate(
  key: SmsTemplateKey,
  saved: SmsTemplates | null | undefined,
  vertical: string | null | undefined,
): string {
  const override = saved?.[key]?.trim();
  if (override) return override;
  return defaultTemplatesForVertical(vertical)[key];
}

/** Interpolates {{var}} placeholders. Unknown placeholders are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => vars[k] ?? m);
}

/** Coerces an unknown JSON value into a clean SmsTemplates (string keys only). */
export function parseSmsTemplates(raw: unknown): SmsTemplates {
  if (!raw || typeof raw !== "object") return {};
  const out: SmsTemplates = {};
  for (const key of SMS_TEMPLATE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}
