/**
 * src/lib/outreach/instantlyClient.ts
 * SERVER-SIDE ONLY. Module 4 — Instantly dispatcher.
 *
 * Injects leads into an Instantly campaign mapped to Instantly's lead schema:
 *   email, first_name, custom_variables.custom_hook, custom_variables.custom_clean_name.
 * Instantly OWNS send cadence / daily limits / warmup — so we DON'T sleep-throttle
 * per lead (that just burns serverless wall-clock). We chunk bulk injects to be a
 * good API citizen and let Instantly drip-send.
 *
 * GRACEFUL: no INSTANTLY_API_KEY (or no campaign id) → returns a not-configured
 * result instead of throwing, so generation still works end-to-end without it.
 */

const INSTANTLY_BASE = "https://api.instantly.ai/api/v2";

export interface InstantlyLead {
  email:            string;
  first_name:       string;
  custom_hook:      string;
  custom_clean_name: string;
  // Full merge set so the Instantly campaign template can render Lewis's exact
  // email (subject {{subject_line}}, body {{email_body}}) AND any follow-up steps
  // can use the individual niche/region-aware variables.
  company_name?:           string;
  subject_line?:           string;
  email_body?:             string;
  // Follow-up steps 2-4, fully rendered, so the WHOLE sequence is app-controlled.
  subject_2?:              string;
  email_body_2?:           string;
  subject_3?:              string;
  email_body_3?:           string;
  subject_4?:              string;
  email_body_4?:           string;
  city?:                   string;
  niche_service?:          string;
  regional_booking_term?:  string;
  regional_revenue_term?:  string;
  your_name?:              string;
}

export interface InstantlyInjectResult {
  ok:           boolean;
  injected:     number;
  failed:       number;
  notConfigured?: boolean;
  error?:       string;
  /** Per-lead ids returned by Instantly, indexed to the input order where known. */
  leadIds:      (string | null)[];
}

export function instantlyConfigured(): boolean {
  return Boolean(process.env.INSTANTLY_API_KEY && process.env.INSTANTLY_CAMPAIGN_ID);
}

interface InstantlyCreateResponse { id?: string }

const MAX_RETRIES = 2;

/** Redacts anything secret-looking before a response body hits the logs. */
function redact(s: string): string {
  return s.replace(/(sk[_-][a-z0-9]+|api[_-]?key["':=\s]+[^\s"']+|Bearer\s+[^\s"']+)/gi, "[REDACTED]");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Injects a single lead with bounded retry/backoff on 429 + 5xx (transient).
 * Returns the Instantly lead id, or null on permanent failure. Never throws.
 */
async function injectOne(lead: InstantlyLead): Promise<string | null> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID;
  if (!apiKey || !campaignId) return null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Only send defined custom variables (Instantly stores whatever it's given).
      const customVariables: Record<string, string> = {
        custom_hook:       lead.custom_hook,
        custom_clean_name: lead.custom_clean_name,
      };
      const optional: Record<string, string | undefined> = {
        company_name:          lead.company_name,
        subject_line:          lead.subject_line,
        email_body:            lead.email_body,
        subject_2:             lead.subject_2,
        email_body_2:          lead.email_body_2,
        subject_3:             lead.subject_3,
        email_body_3:          lead.email_body_3,
        subject_4:             lead.subject_4,
        email_body_4:          lead.email_body_4,
        city:                  lead.city,
        niche_service:         lead.niche_service,
        regional_booking_term: lead.regional_booking_term,
        regional_revenue_term: lead.regional_revenue_term,
        your_name:             lead.your_name,
      };
      for (const [k, v] of Object.entries(optional)) if (typeof v === "string" && v.length) customVariables[k] = v;

      const res = await fetch(`${INSTANTLY_BASE}/leads`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          campaign:    campaignId,
          email:       lead.email,
          first_name:  lead.first_name,
          custom_variables: customVariables,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as InstantlyCreateResponse;
        return data.id ?? null;
      }
      // Retry transient failures (rate limit / server error) with backoff.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * (attempt + 1));
        continue;
      }
      const text = await res.text().catch(() => "");
      console.error(`[instantly] inject ${lead.email} → HTTP ${res.status}: ${redact(text).slice(0, 160)}`);
      return null;
    } catch (err) {
      if (attempt < MAX_RETRIES) { await sleep(800 * (attempt + 1)); continue; }
      console.error(`[instantly] inject ${lead.email} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  return null;
}

/**
 * Bulk-injects leads. NEVER THROWS. Runs in small concurrent chunks (deliverability
 * throttling is Instantly's job, not ours). Returns counts + per-lead ids.
 */
export async function injectLeads(leads: InstantlyLead[]): Promise<InstantlyInjectResult> {
  if (!instantlyConfigured()) {
    return { ok: false, injected: 0, failed: leads.length, notConfigured: true, leadIds: leads.map(() => null), error: "INSTANTLY_API_KEY / INSTANTLY_CAMPAIGN_ID not configured" };
  }

  const CHUNK = 5;
  const leadIds: (string | null)[] = [];
  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    const ids = await Promise.all(slice.map(injectOne));
    leadIds.push(...ids);
  }

  const injected = leadIds.filter((id) => id !== null).length;
  return { ok: injected > 0, injected, failed: leadIds.length - injected, leadIds };
}

// ── Reply sending (autonomous reply layer) ──────────────────────────────────
// Sends a reply to a prospect who answered a cold email. NOTE: Instantly's API
// surface for threaded replies varies by account/plan; this attempts the v2
// reply endpoint and returns ok=false (never throws) if it's unavailable, so the
// caller can fall back to handing the drafted reply to the owner instead of
// silently dropping it. Verify the exact endpoint against your Instantly account.
export interface SendReplyInput {
  toEmail:   string;
  body:      string;
  leadId?:   string | null; // Instantly lead id, when known
  subject?:  string;
}

export interface SendReplyResult {
  ok:            boolean;
  notConfigured?: boolean;
  error?:        string;
}

export async function sendReply(input: SendReplyInput): Promise<SendReplyResult> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID;
  if (!apiKey || !campaignId) {
    return { ok: false, notConfigured: true, error: "Instantly not configured" };
  }
  try {
    const res = await fetch(`${INSTANTLY_BASE}/emails/reply`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        campaign:   campaignId,
        lead:       input.leadId ?? undefined,
        eaccount_email: input.toEmail,
        to:         input.toEmail,
        subject:    input.subject,
        body:       input.body,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[instantly] reply ${input.toEmail} → HTTP ${res.status}: ${redact(text).slice(0, 160)}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[instantly] reply ${input.toEmail} failed:`, err instanceof Error ? err.message : err);
    return { ok: false, error: err instanceof Error ? err.message : "error" };
  }
}
