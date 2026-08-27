import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client.
 *
 * This key bypasses Row Level Security entirely, so it must never reach the
 * browser: no NEXT_PUBLIC_ prefix, never imported into a Client Component,
 * and every call made through it is one the server has already authorised
 * itself. It exists for the things a user must not be able to do on their own
 * behalf — mint an API key hash, mark an order paid, grant a subscription,
 * count metered usage.
 *
 * Everything a user *can* do for themselves goes through their own session
 * and RLS instead.
 */

let cached: SupabaseClient | null = null;
let cachedFor: string | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  // Cached per credential pair so rotating the key in the environment takes
  // effect without a restart, while steady state does not rebuild a client
  // on every request.
  const fingerprint = `${url}:${serviceKey.slice(-8)}`;
  if (cached && cachedFor === fingerprint) return cached;

  cached = createClient(url, serviceKey, {
    auth: {
      // A server client has no user to persist and no session to refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  cachedFor = fingerprint;
  return cached;
}
