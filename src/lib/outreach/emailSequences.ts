/**
 * src/lib/outreach/emailSequences.ts
 * The complete 5-email cold sequence as a typed structure — the EXACT copy Lewis
 * uses to sign aesthetics clients. Templates use {{variable}} placeholders that
 * sequenceBuilder.ts substitutes per prospect. Pure data + a renderer; no I/O.
 *
 * Cadence (days): 0 Hook · 4 Problem · 8 Proof · 11 Pattern-interrupt · 14 Breakup.
 * Email 1 has three A/B subject variants (rotated across prospects).
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
  first_name:    string;
  business_name: string;
  location:      string;
  custom_hook:   string;
  call_link?:    string; // optional — email 3 call recording, blank until available
}

export const EMAIL_SEQUENCE: EmailTemplate[] = [
  {
    emailNumber: 1,
    day: 0,
    subjects: [
      "free for 28 days — {{business_name}}",
      "100% risk free — {{location}} aesthetics",
      "we take all the risk",
    ],
    body: `Hey {{first_name}},

{{custom_hook}}

I'll cut straight to it. I am honestly sick of seeing marketing agencies charge businesses thousands in upfront costs before they've even proven they can book a single customer for you.

I don't think you should have to pay for something until you've actually seen it work.

So, for the next 4 weeks, we want to fully manage your ads, call every single lead within 60 seconds, handle all the follow-up, send SMS reminders, and hand-deliver booked consultations straight to your calendar. Completely free.

You just show up and do your job. We handle the rest.

Zero setup fees. Zero upfront retainers. No contract. If we don't bring you actual paying clients in the next 28 days, you owe us nothing. You keep everything we build.

We're taking 100% of the risk because that's how it should work — value first.

We can only do this for 2 clinics right now.

Worth a quick 5-minute call to see how we do it?

Lewis
Aurum Growth`,
  },
  {
    emailNumber: 2,
    day: 4,
    subjects: ["what happens at 9pm on a Sunday?"],
    body: `Hey {{first_name}},

Quick follow-up.

Here's something that costs aesthetics clinics thousands every month without them realising it.

Someone sees your ad at 9pm on a Sunday. They fill in the form. They're interested.

Nobody calls them until Monday morning.

By then they've already booked with someone else — or talked themselves out of it.

We built something that calls every lead within 60 seconds of them filling in your form. Automatically. At 9pm on a Sunday. While you're watching Netflix.

If that's worth 5 minutes of your time, I'd love to show you.

Lewis`,
  },
  {
    emailNumber: 3,
    day: 8,
    subjects: ["43 seconds"],
    body: `Hey {{first_name}},

I'll keep this short.

This is what it looks like when someone fills in a form at 11pm and gets called 43 seconds later: {{call_link}}

No human involved. Fully automatic.

That's what we're offering to set up for your clinic, free for 28 days.

Still interested?

Lewis`,
  },
  {
    emailNumber: 4,
    day: 11,
    subjects: ["my system glitched — morning or afternoon?"],
    body: `Hey {{first_name}},

My email system showed your message was half-delivered last week — apologies if this is coming out of nowhere.

I've been trying to get 5 minutes to show you how we're filling aesthetics clinics with booked consultations automatically.

Quick question — if we did get on a call, would morning or afternoon work better for you?

Lewis`,
  },
  {
    emailNumber: 5,
    day: 14,
    subjects: ["closing your file"],
    body: `Hey {{first_name}},

I won't keep following up after this — I know your inbox is busy.

Just wanted to leave the door open. If you ever want to see how other clinics in {{location}} are getting booked consultations handed to them automatically — no upfront cost, no contract — you know where to find me.

Lewis
Aurum Growth`,
  },
];

/** Default placeholder for the email-3 call recording until a real link exists. */
export const CALL_LINK_PLACEHOLDER = "[call recording link — add when available]";

/** Substitutes {{vars}} in a template string. Unknown placeholders are left intact. */
export function renderTemplate(tpl: string, vars: SequenceVars): string {
  const map: Record<string, string> = {
    first_name:    vars.first_name,
    business_name: vars.business_name,
    location:      vars.location,
    custom_hook:   vars.custom_hook,
    call_link:     vars.call_link?.trim() || CALL_LINK_PLACEHOLDER,
  };
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (k in map ? map[k] : m));
}

/**
 * Picks the email-1 subject variant for an A/B rotation index, then renders it.
 * Emails 2-5 have a single subject. variantIndex rotates 0,1,2 across prospects.
 */
export function renderSubject(tpl: EmailTemplate, vars: SequenceVars, variantIndex = 0): string {
  const subj = tpl.subjects[variantIndex % tpl.subjects.length] ?? tpl.subjects[0];
  return renderTemplate(subj, vars);
}
