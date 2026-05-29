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
}

/**
 * Wraps an async function with exponential backoff retry logic.
 * Delays: baseDelayMs * 2^(attempt-1) — e.g. 500ms, 1000ms, 2000ms
 * Throws after maxAttempts with a descriptive message including label and original error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const label = opts.label ?? "unknown";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
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
    `[withRetry] ${label} — all ${maxAttempts} attempts failed. Last error: ${originalMessage}`
  );
}
