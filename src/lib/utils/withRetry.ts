/**
 * GR-02 — All External API Calls via withRetry()
 * Every call to OpenAI, Meta Ads, Retell, Twilio, Higgsfield, and Vercel
 * must be wrapped in withRetry(fn, { maxAttempts: 3, baseDelayMs: 500, label: "ServiceName.method" }).
 * Direct calls without retry are a contract violation.
 */

export interface RetryOptions {
  /** Maximum number of attempts. Default: 3 */
  maxAttempts?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 500 */
  baseDelayMs?: number;
  /** Human-readable label for error messages. Default: "unknown" */
  label?: string;
  /**
   * Predicate to decide whether an error is worth retrying. Default: retry
   * everything (back-compat). Return false to FAIL FAST on permanent errors
   * (HTTP 400/401/403/404/422) so we don't burn the retry budget — see
   * isTransientError for the standard rule.
   */
  shouldRetry?: (err: unknown) => boolean;
  /** Add ±25% random jitter to each delay to avoid a thundering herd. Default: true. */
  jitter?: boolean;
}

/**
 * Standard transient-vs-permanent classifier for external-API errors. Retries
 * rate limits (429), server errors (5xx), and network/timeout failures; does NOT
 * retry permanent client errors (400/401/403/404/422). Errors whose class is
 * unknown are treated as transient (safe default for back-compat).
 */
export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Permanent client errors — never worth retrying.
  if (/\b(HTTP\s*)?(400|401|403|404|422)\b/.test(msg)) return false;
  if (/\b(unauthorized|forbidden|invalid|bad request|not found)\b/i.test(msg)) return false;
  return true; // 429, 5xx, ECONNRESET, ETIMEDOUT, aborts, unknowns
}

/**
 * Wraps an async function with exponential-backoff retry logic.
 * Delays: baseDelayMs * 2^(attempt-1) (+ jitter) — e.g. ~500ms, ~1s, ~2s.
 * Stops early when shouldRetry(err) is false. Throws after maxAttempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const label = opts.label ?? "unknown";
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const jitter = opts.jitter ?? true;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Fail fast on permanent errors — don't waste the retry budget.
      if (!shouldRetry(err)) {
        console.warn(`[withRetry] ${label} — non-retryable error, failing fast.`, err instanceof Error ? err.message : String(err));
        break;
      }

      if (attempt < maxAttempts) {
        const base = baseDelayMs * Math.pow(2, attempt - 1);
        const delayMs = jitter ? Math.round(base * (0.75 + Math.random() * 0.5)) : base;
        console.warn(
          `[withRetry] ${label} — attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs}ms.`,
          err instanceof Error ? err.message : String(err)
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const originalMessage =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `[withRetry] ${label} — attempts failed. Last error: ${originalMessage}`
  );
}
