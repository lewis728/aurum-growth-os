/**
 * src/lib/outreach/emailSequences.ts
 * The cold sequence as a typed structure. Email 1 is Lewis's exact "1-month trial"
 * pitch; emails 2-4 are short, NICHE-NEUTRAL follow-up bumps (no "clinic"/
 * "consultation" wording) so the same sequence works for all 6 launch niches.
 *
 * Templates use {{variable}} placeholders that sequenceBuilder.ts substitutes per
 * prospect — including the niche/region-aware merge tags
 * ({{niche_service}}, {{regional_booking_term}}, {{regional_revenue_term}}).
 * Email 1 ships 4 A/B subject variants (rotated + self-tuned by abTuner). Pure data
 * + a renderer; no I/O.
 *
 * Cadence (days): 0 Pitch · 3 Bump · 7 Cost-of-slow · 12 Breakup.
 */

export interface EmailTemplate {
  emailNumber: number;
  day:         number;
  /** First entry is the default; extra entries are A/B variants (email 1 only). */
  subjects:    string[];
  body:        string;
}

export interface RenderedEmail {
  emailNumber: number;
  day:         number;
  subject:     string;
  body:        string;
}

/** Every placeholder the templates can reference. */
export interface SequenceVars {
  first_name:             string;
  business_name:          string;  // clean company name (kept for back-compat)
  company_name:           string;  // {{company_name}} — same clean name, explicit tag
  location:               string;
  city:                   string;  // {{city}}
  niche_service:          string;  // {{niche_service}}
  regional_booking_term:  string;  // {{regional_booking_term}}
  regional_revenue_term:  string;  // {{regional_revenue_term}}
  custom_hook:            string;  // {{custom_hook}} / {{ai_personalized_hook}}
  your_name:              string;  // {{your_name}}
  call_link?:             string;
}

export const EMAIL_SEQUENCE: EmailTemplate[] = [
  {
    emailNumber: 1,
    day: 0,
    subjects: [
      "1 month trial of client acquisition for {{company_name}}",
      "{{company_name}} — 4 weeks of client acquisition, on us",
      "quick idea for {{company_name}} in {{city}}",
      "we'll fill your calendar for 30 days, free — {{company_name}}",
    ],
    body: `Hey {{first_name}},

{{custom_hook}}

My team and I build custom growth systems designed to scale local client volume for premium operators like {{company_name}}, using the high-performance frameworks we engineer.

Essentially, we deploy dedicated campaigns tailored specifically to the {{city}} market to capture high-intent demand for you. The exact millisecond a local customer shows interest in {{niche_service}}, our system triggers an instant phone call to them within 60 seconds. We qualify them on the spot, confirm their urgency, and book them directly into an open slot on the {{company_name}} calendar before they can close their browser or call a competitor.

Because the market is full of empty promises, we prefer to prove our value upfront. We want to deploy and run this entire client-acquisition system for your business for the next 4 weeks completely on our own dime. We look at it as a capital investment on our end to build a brand new pie together to both eat from.

During this 4-week pilot, you keep 100% of the {{regional_revenue_term}} from every single {{regional_booking_term}} our system maps onto your calendar.

If the growth is undeniable on day 30, we transition to a flat monthly retainer to keep your pipeline running. We take our flat slice of the pie, and you keep 100% of the unlimited upside as you scale. If it doesn't work out, we turn off the valve, shake hands, and you keep every penny we generated.

Sound fair? If your team in {{city}} has the physical capacity to handle a wave of new clients right now, let me know if you're open to a quick 5-minute call to look at the calendar math.

Best,

— {{your_name}}`,
  },
  {
    emailNumber: 2,
    day: 3,
    subjects: ["quick one, {{first_name}}"],
    body: `Hey {{first_name}},

Quick follow-up on my last email.

The whole offer is genuinely risk-free: we run the entire client-acquisition system for {{company_name}} for 4 weeks on our own dime, and you keep 100% of the {{regional_revenue_term}} from every {{regional_booking_term}} we put on your calendar.

If it doesn't work, you've lost nothing and you keep everything we built.

Worth a quick 5 minutes to look at the calendar math?

— {{your_name}}`,
  },
  {
    emailNumber: 3,
    day: 7,
    subjects: ["what happens at 9pm on a Sunday?"],
    body: `Hey {{first_name}},

Here's the thing that quietly costs {{company_name}} {{regional_booking_term}}s every week.

Someone needs {{niche_service}} at 9pm on a Sunday. They find you, they enquire, they're ready.

Nobody calls them back until Monday — and by then they've already gone with whoever picked up first.

Our system calls every new enquiry within 60 seconds, day or night, qualifies them, and books them straight onto your calendar. For the next 4 weeks we'll run the whole thing for free.

Want me to show you how it'd look for {{company_name}}?

— {{your_name}}`,
  },
  {
    emailNumber: 4,
    day: 12,
    subjects: ["closing your file"],
    body: `Hey {{first_name}},

I won't keep chasing — I know you're busy running {{company_name}}.

Just leaving the door open. If you ever want a month of {{niche_service}} {{regional_booking_term}}s handed straight to your calendar with zero risk and no upfront cost, you know where I am.

Best,

— {{your_name}}`,
  },
];

/** Default placeholder for the email-3 call recording until a real link exists. */
export const CALL_LINK_PLACEHOLDER = "[call recording link — add when available]";

/** Substitutes {{vars}} in a template string. Unknown placeholders are left intact. */
export function renderTemplate(tpl: string, vars: SequenceVars): string {
  const map: Record<string, string> = {
    first_name:            vars.first_name,
    business_name:         vars.business_name,
    company_name:          vars.company_name || vars.business_name,
    location:              vars.location,
    city:                  vars.city || vars.location,
    niche_service:         vars.niche_service,
    regional_booking_term: vars.regional_booking_term,
    regional_revenue_term: vars.regional_revenue_term,
    custom_hook:           vars.custom_hook,
    ai_personalized_hook:  vars.custom_hook, // alias for the spec's tag name
    your_name:             vars.your_name,
    call_link:             vars.call_link?.trim() || CALL_LINK_PLACEHOLDER,
  };
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (k in map ? map[k] : m));
}

/**
 * Picks the email-1 subject variant for an A/B rotation index, then renders it.
 * Emails 2-4 have a single subject. variantIndex rotates across all variants.
 */
export function renderSubject(tpl: EmailTemplate, vars: SequenceVars, variantIndex = 0): string {
  const subj = tpl.subjects[variantIndex % tpl.subjects.length] ?? tpl.subjects[0];
  return renderTemplate(subj, vars);
}
