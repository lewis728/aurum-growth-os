/**
 * src/lib/contractorToken.ts
 * Magic-link auth for the contractor portal — no Clerk. A signed (HMAC-SHA256)
 * token encodes the contractorId + issue time; the portal verifies it. Contractors
 * are buyers, not platform users, so this is all the auth they need.
 */
import crypto from "crypto";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  return process.env.CONTRACTOR_PORTAL_SECRET ?? process.env.CLERK_SECRET_KEY ?? "";
}

interface TokenPayload {
  contractorId?: string;
  issuedAt?: string;
  sig?: string;
}

export function signContractorToken(contractorId: string): string {
  const issuedAt = Date.now().toString();
  const sig = crypto.createHmac("sha256", secret()).update(`${contractorId}:${issuedAt}`).digest("hex");
  return Buffer.from(JSON.stringify({ contractorId, issuedAt, sig })).toString("base64url");
}

/** Returns the contractorId if the token is valid + unexpired, else null. */
export function verifyContractorToken(token: string): string | null {
  try {
    const key = secret();
    if (!key) return null;
    const { contractorId, issuedAt, sig } = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    ) as TokenPayload;
    if (!contractorId || !issuedAt || !sig) return null;

    const expected = crypto.createHmac("sha256", key).update(`${contractorId}:${issuedAt}`).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    if (Date.now() - parseInt(issuedAt, 10) > MAX_AGE_MS) return null;
    return contractorId;
  } catch {
    return null;
  }
}

export function contractorPortalUrl(origin: string, contractorId: string): string {
  return `${origin}/contractor/${contractorId}?token=${signContractorToken(contractorId)}`;
}
