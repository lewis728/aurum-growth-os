/**
 * src/lib/leads/emailFinder.ts
 * SERVER-SIDE ONLY. The "get the real owner email" step — finds the decision-maker's
 * email for a domain (Findymail or Hunter), preferring a PERSONAL mailbox over a
 * generic role one. Provider-agnostic seam; GRACEFUL — no key → null. NEVER THROWS.
 *
 * The app's role-guard + verifier still run downstream, so a role/invalid result is
 * dropped; this just maximises the chance of reaching the owner, not a department.
 */

import { withRetry, isTransientError } from "@/lib/utils/withRetry";
import { isRoleEmail } from "@/lib/outreach/decisionMaker";

export interface FoundEmail { email: string; name: string | null; source: string }

function provider(): string {
  return (process.env.LEAD_EMAIL_FINDER ?? "findymail").trim().toLowerCase();
}

export function emailFinderConfigured(): boolean {
  if (provider() === "findymail") return Boolean(process.env.FINDYMAIL_API_KEY);
  if (provider() === "hunter") return Boolean(process.env.HUNTER_API_KEY);
  return false;
}

/** Picks the best candidate: a verified-personal mailbox over a role inbox. */
function pickBest(cands: Array<{ email: string; name: string | null; personal: boolean }>): FoundEmail | null {
  const valid = cands.filter((c) => c.email && c.email.includes("@"));
  if (valid.length === 0) return null;
  const personal = valid.find((c) => c.personal && !isRoleEmail(c.email));
  const nonRole = valid.find((c) => !isRoleEmail(c.email));
  const chosen = personal ?? nonRole ?? valid[0];
  return { email: chosen.email.toLowerCase(), name: chosen.name, source: provider() };
}

interface FindymailContact { email?: string; name?: string }
interface FindymailResponse { contacts?: FindymailContact[] }

async function findFindymail(domain: string): Promise<FoundEmail | null> {
  const key = process.env.FINDYMAIL_API_KEY;
  if (!key) return null;
  const data = await withRetry(
    async () => {
      const res = await fetch("https://app.findymail.com/api/search/domain", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ domain, roles: false }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as FindymailResponse;
    },
    { maxAttempts: 2, baseDelayMs: 800, label: "emailFinder.findymail", shouldRetry: isTransientError },
  );
  return pickBest((data.contacts ?? []).map((c) => ({ email: c.email ?? "", name: c.name ?? null, personal: true })));
}

interface HunterEmail { value?: string; type?: string; first_name?: string; last_name?: string }
interface HunterResponse { data?: { emails?: HunterEmail[] } }

async function findHunter(domain: string): Promise<FoundEmail | null> {
  const key = process.env.HUNTER_API_KEY;
  if (!key) return null;
  const data = await withRetry(
    async () => {
      const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${key}&limit=10`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as HunterResponse;
    },
    { maxAttempts: 2, baseDelayMs: 800, label: "emailFinder.hunter", shouldRetry: isTransientError },
  );
  return pickBest((data.data?.emails ?? []).map((e) => ({
    email: e.value ?? "",
    name: [e.first_name, e.last_name].filter(Boolean).join(" ") || null,
    personal: (e.type ?? "") === "personal",
  })));
}

/** Finds the best owner email for a domain. Returns null if not found / unconfigured. NEVER THROWS. */
export async function findOwnerEmail(domain: string | null | undefined): Promise<FoundEmail | null> {
  const d = (domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d || !d.includes(".")) return null;
  try {
    if (provider() === "findymail") return await findFindymail(d);
    if (provider() === "hunter") return await findHunter(d);
    return null;
  } catch (err) {
    console.error("[emailFinder] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
