import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase auth, wired so that an unconfigured deployment still runs.
 *
 * The editor and the marketing site have to work before anyone sets up a
 * Supabase project — a contributor cloning this repo should get a working
 * app, not a stack trace. So every accessor returns null when the
 * environment is missing, and callers treat "no client" as "nobody is signed
 * in" rather than as an error.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export const isAuthConfigured = () => supabaseEnv() !== null;

/** Browser-side client, for sign-in forms and sign-out. */
export function browserClient(): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;
  return createBrowserClient(env.url, env.anonKey);
}

export interface CookieStore {
  getAll: () => { name: string; value: string }[];
  set?: (name: string, value: string, options?: Record<string, unknown>) => void;
}

/**
 * Server-side client bound to one request's cookies.
 *
 * `set` is optional because Server Components cannot write cookies: Supabase
 * will try to refresh an expiring session there, and the write has to be a
 * no-op rather than a crash. Middleware is where refreshed cookies actually
 * get persisted.
 */
export function serverClient(cookies: CookieStore): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (items) => {
        if (!cookies.set) return;
        for (const { name, value, options } of items) {
          cookies.set(name, value, options as Record<string, unknown>);
        }
      },
    },
  });
}
