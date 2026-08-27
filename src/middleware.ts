import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/auth/supabase";

/**
 * Refreshes the Supabase session on every navigation.
 *
 * Access tokens are short-lived. Server Components cannot write cookies, so
 * without this the refreshed token would be thrown away on every request and
 * a signed-in user would be logged out roughly every hour. Middleware is the
 * one place in the request lifecycle that can both read the old cookie and
 * write the new one.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = serverClient({
    getAll: () =>
      request.cookies.getAll().map(({ name, value }) => ({ name, value })),
    set: (name, value, options) => {
      response.cookies.set(name, value, options);
    },
  });

  // Unconfigured deployment: nothing to refresh, and the app still works.
  if (supabase) {
    await supabase.auth.getUser();
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the embed itself. The embed runs
     * inside someone else's page and is addressed by document id rather than
     * by session, so putting it behind a session refresh would add a Supabase
     * round trip to every iframe load for no benefit.
     */
    "/((?!_next/static|_next/image|favicon.ico|dockaro.js|e/|api/v1/documents).*)",
  ],
};
