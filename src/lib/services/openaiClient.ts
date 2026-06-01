/**
 * src/lib/services/openaiClient.ts
 * SERVER-SIDE ONLY. The ONE shared OpenAI client — with a request timeout and
 * built-in SDK retries — so we don't get a thundering herd of un-bounded, never-
 * timing-out GPT calls at scale (5000 clients × no timeout = cascading hangs that
 * exhaust the function and the DB pool behind it).
 *
 * The OpenAI SDK applies `timeout` + `maxRetries` (exponential backoff, honours
 * Retry-After on 429) to every call automatically. Per-call sites can still pass
 * a per-request timeout override via the 2nd arg if a job needs longer.
 *
 * Migrate `new OpenAI({ apiKey })` call sites to `import { openai } from
 * "@/lib/services/openaiClient"` to inherit the timeout everywhere.
 */

import OpenAI from "openai";

const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 30_000);
const DEFAULT_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES ?? 2);

/**
 * The ONE place model ids are named, so a model upgrade is a single env flip and
 * never a code change scattered across call sites.
 *
 * `primary` is Marcus's reasoning model and the default for every high-stakes
 * completion (CBR diagnosis, briefings, report writing). Specs sometimes reference
 * an unreleased successor (e.g. a future "gpt-5.5") — we deliberately default to
 * the real, currently-available model (`gpt-4o`) so nothing 404s in production,
 * and expose `OPENAI_PRIMARY_MODEL` so the day a successor ships it's one env var,
 * zero code change. `embedding` powers the vector layer (CBR + cross-client
 * knowledge); it MUST stay 1536-dim to match the `vector(1536)` columns.
 */
export const MODELS = {
  primary:   process.env.OPENAI_PRIMARY_MODEL ?? "gpt-4o",
  mini:      process.env.OPENAI_MINI_MODEL    ?? "gpt-4o-mini",
  embedding: process.env.OPENAI_EMBED_MODEL   ?? "text-embedding-3-small",
} as const;

// Lazy singleton so importing this module never throws when the key is absent
// (scripts, dry-runs). Constructed on first real use.
let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey:     process.env.OPENAI_API_KEY,
      timeout:    DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    });
  }
  return _client;
}

/**
 * Proxy that lazily forwards to the configured singleton, so existing code can do
 * `openai.chat.completions.create(...)` unchanged and still inherit the timeout.
 */
export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_t, prop) {
    const client = getOpenAI() as unknown as Record<string | symbol, unknown>;
    const v = client[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(client) : v;
  },
});
