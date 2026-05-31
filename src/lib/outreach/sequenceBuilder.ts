/**
 * src/lib/outreach/sequenceBuilder.ts
 * SERVER-SIDE ONLY. Turns a prospect into a complete, ready-to-import 5-email
 * sequence: generates the personalised hook (Writer→Critic), then renders every
 * template with the prospect's variables, pre-stamps the cadence (day 0/4/8/11/14)
 * onto scheduledAt, and rotates the email-1 A/B subject by variant index.
 *
 * Returns plain data — callers persist it (OutreachSequence rows) or hand it to
 * the UI for copy/paste. NEVER THROWS (hook generation is graceful).
 */

import { EMAIL_SEQUENCE, renderTemplate, renderSubject, type RenderedEmail, type SequenceVars } from "@/lib/outreach/emailSequences";
import { generateHook, type HookInput } from "@/lib/outreach/hookGenerator";

export interface BuildInput {
  firstName:    string;
  businessName: string;
  cleanName?:   string;
  location?:    string;
  vertical?:    string;
  website?:     string;
  treatments?:  string;
  websiteText?: string;
  hasAds?:      boolean;
  reviewCount?: number;
  reviewRating?: number;
  callLink?:    string;
  /** Rotates the email-1 subject A/B variant (0,1,2). */
  variantIndex?: number;
  /** Reuse a hook already generated (skip the LLM round-trip). */
  existingHook?: string;
  /** Anchor for cadence scheduling; defaults to now at call time. */
  startAt?:     Date;
}

export interface BuiltSequence {
  customHook: string;
  hookApproved: boolean;
  hookFallback: boolean;
  emails: (RenderedEmail & { scheduledAt: string })[];
}

/** Adds whole days to a date, returning a new Date. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function buildSequence(input: BuildInput): Promise<BuiltSequence> {
  const start = input.startAt ?? new Date();

  let customHook = input.existingHook?.trim() ?? "";
  let hookApproved = Boolean(input.existingHook);
  let hookFallback = false;

  if (!customHook) {
    const hookInput: HookInput = {
      businessName: input.businessName,
      cleanName:    input.cleanName,
      location:     input.location,
      vertical:     input.vertical,
      treatments:   input.treatments,
      website:      input.website,
      websiteText:  input.websiteText,
      hasAds:       input.hasAds,
      reviewCount:  input.reviewCount,
      reviewRating: input.reviewRating,
    };
    const res = await generateHook(hookInput);
    customHook = res.custom_hook;
    hookApproved = res.approved;
    hookFallback = Boolean(res.fallback);
  }

  const vars: SequenceVars = {
    first_name:    input.firstName || "there",
    business_name: input.cleanName || input.businessName,
    location:      input.location || "your area",
    custom_hook:   customHook,
    call_link:     input.callLink,
  };

  const emails = EMAIL_SEQUENCE.map((tpl) => ({
    emailNumber: tpl.emailNumber,
    day:         tpl.day,
    subject:     renderSubject(tpl, vars, tpl.emailNumber === 1 ? (input.variantIndex ?? 0) : 0),
    body:        renderTemplate(tpl.body, vars),
    scheduledAt: addDays(start, tpl.day).toISOString(),
  }));

  return { customHook, hookApproved, hookFallback, emails };
}
