/**
 * src/lib/utils/concurrency.ts
 * SERVER-SIDE ONLY. Bounded-concurrency runner for cron fan-out at scale.
 *
 * Replaces `Promise.allSettled(all.map(fn))` — which opens N concurrent DB
 * connections + API calls at once (fatal at 1000+ clients against a capped pool) —
 * with a worker pool that runs at most `concurrency` items in flight. Each item is
 * isolated: one throw never aborts the batch; the result array preserves order with
 * { status } like allSettled. NEVER THROWS.
 */

export interface SettledOk<T> { status: "fulfilled"; value: T; }
export interface SettledErr { status: "rejected"; reason: unknown; }
export type Settled<T> = SettledOk<T> | SettledErr;

/**
 * Runs `worker` over `items` with at most `concurrency` in flight. Returns results
 * in input order with allSettled-style { status }. A worker that throws is captured
 * as { status: "rejected" } — the batch always completes.
 */
export async function mapPool<I, O>(
  items: readonly I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const results: Settled<O>[] = new Array(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, run));
  return results;
}
