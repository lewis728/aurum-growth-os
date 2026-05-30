/**
 * src/lib/supabaseBrowser.ts
 * CLIENT-SIDE Supabase client for Realtime subscriptions.
 *
 * Uses the public anon key (never the service role) so it is safe to ship to
 * the browser. Returns null if the public env vars are not configured, so
 * callers degrade gracefully to a static (non-live) view.
 *
 * Required env (add to Vercel + .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (typeof window !== "undefined") {
      console.warn("[supabaseBrowser] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set — live feed disabled.");
    }
    cached = null;
    return cached;
  }

  cached = createClient(url, anonKey, {
    auth:     { persistSession: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return cached;
}
