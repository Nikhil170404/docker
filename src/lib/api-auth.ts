import { NextRequest, NextResponse } from "next/server";
import { meterRequest, usageHeaders, type UsageState } from "@/lib/api-usage";

// Demo key store. Swap for a real table (apiKeys: {hash, userId, plan, createdAt})
// once auth/billing is wired up — keys here reset whenever the server restarts.
const DEMO_KEYS = new Set(["dk_test_51H7x9pQwErTyUiOpAsDfGh"]);

export type AuthResult =
  | { ok: false; response: NextResponse }
  | { ok: true; key: string; usage: UsageState; headers: Record<string, string> };

/**
 * Authenticate the caller and meter the request in one pass. Every successful
 * result carries `headers` describing where the caller stands against their
 * quota — attach them to the response so consumption is visible on every
 * single call rather than at invoice time.
 */
export function authorize(req: NextRequest): AuthResult {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!key || !DEMO_KEYS.has(key)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "unauthorized",
            message:
              "Missing or invalid API key. Pass it as 'Authorization: Bearer dk_live_...'.",
          },
        },
        { status: 401 },
      ),
    };
  }

  const { state, limitResponse } = meterRequest(key);
  if (limitResponse) return { ok: false, response: limitResponse };

  return { ok: true, key, usage: state, headers: usageHeaders(state) };
}
