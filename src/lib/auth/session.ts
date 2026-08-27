import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { serverClient } from "./supabase";

/**
 * Who is making this request.
 *
 * Everything funnels through here so there is exactly one answer to that
 * question, and exactly one place to change when authorisation grows past
 * "is anyone signed in".
 */

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user for a Server Component or Route Handler.
 *
 * `getUser()` rather than `getSession()`: getSession trusts whatever is in
 * the cookie, which the browser controls. getUser revalidates the token with
 * Supabase, which is the difference between an identity and a claim.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const supabase = serverClient({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    // Server Components cannot write cookies; middleware refreshes instead.
  });
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

/** The same question, for a Route Handler that already holds the request. */
export async function userFromRequest(
  req: NextRequest,
): Promise<SessionUser | null> {
  const supabase = serverClient({
    getAll: () => req.cookies.getAll().map(({ name, value }) => ({ name, value })),
  });
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}
