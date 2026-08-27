import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/auth/supabase";

/**
 * Where Supabase sends the browser after an email link or an OAuth provider.
 * The code in the query string is exchanged for a session, and the cookies
 * that come back are written onto the redirect response.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // Only ever redirect within this site: an open redirect here would let a
  // phishing link borrow our domain for its landing page.
  const requested = url.searchParams.get("next") ?? "/account";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/account";

  const response = NextResponse.redirect(new URL(next, url.origin));
  if (!code) return response;

  const supabase = serverClient({
    getAll: () => req.cookies.getAll().map(({ name, value }) => ({ name, value })),
    set: (name, value, options) => response.cookies.set(name, value, options),
  });
  if (!supabase) return response;

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/signin?error=link_expired", url.origin));
  }
  return response;
}
