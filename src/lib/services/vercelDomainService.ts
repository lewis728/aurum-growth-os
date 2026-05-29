// src/lib/services/vercelDomainService.ts
// Vercel Domain API integration for custom domain management.
// All network calls wrapped in withRetry(). NEVER throws unhandled errors.

import { withRetry } from "@/lib/utils/withRetry";

const BASE = "https://api.vercel.com/v9/projects";

function getEnv(): { token: string; projectId: string } {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token) throw new Error("[vercelDomainService] VERCEL_API_TOKEN is not set");
  if (!projectId) throw new Error("[vercelDomainService] VERCEL_PROJECT_ID is not set");
  return { token, projectId };
}

// ── addCustomDomain ───────────────────────────────────────────────────
// POST /v9/projects/{projectId}/domains
// Treats 409 (domain already added) as success.

export async function addCustomDomain(domain: string): Promise<void> {
  await withRetry(
    async () => {
      const { token, projectId } = getEnv();
      const res = await fetch(`${BASE}/${projectId}/domains`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: domain }),
      });
      // 409 = domain already added — treat as success
      if (res.status === 409) return;
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `[vercelDomainService] addCustomDomain failed (${res.status}): ${body}`
        );
      }
    },
    { maxAttempts: 3, baseDelayMs: 500 }
  );
}

// ── verifyDomain ──────────────────────────────────────────────────────
// GET /v9/projects/{projectId}/domains/{domain}
// Returns verified: true if Vercel reports DNS propagated.
// Returns cnameTarget for DNS setup instructions.

export async function verifyDomain(
  domain: string
): Promise<{ verified: boolean; cnameTarget?: string }> {
  return withRetry(
    async () => {
      const { token, projectId } = getEnv();
      const res = await fetch(`${BASE}/${projectId}/domains/${encodeURIComponent(domain)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `[vercelDomainService] verifyDomain failed (${res.status}): ${body}`
        );
      }
      const json = (await res.json()) as {
        verified?: boolean;
        verification?: Array<{ domain?: string; type?: string; value?: string }>;
        cnames?: Array<{ value?: string }>;
      };
      // Vercel returns verified: true when DNS has propagated
      const verified = json.verified === true;
      // Extract CNAME target from verification hints if available
      const cnameTarget =
        json.cnames?.[0]?.value ??
        json.verification?.find((v) => v.type === "CNAME")?.value ??
        "cname.vercel-dns.com";
      return { verified, cnameTarget };
    },
    { maxAttempts: 3, baseDelayMs: 500 }
  );
}

// ── removeCustomDomain ────────────────────────────────────────────────
// DELETE /v9/projects/{projectId}/domains/{domain}
// Treats 404 (already removed) as success.

export async function removeCustomDomain(domain: string): Promise<void> {
  await withRetry(
    async () => {
      const { token, projectId } = getEnv();
      const res = await fetch(
        `${BASE}/${projectId}/domains/${encodeURIComponent(domain)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      // 404 = already removed — treat as success
      if (res.status === 404) return;
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `[vercelDomainService] removeCustomDomain failed (${res.status}): ${body}`
        );
      }
    },
    { maxAttempts: 3, baseDelayMs: 500 }
  );
}
