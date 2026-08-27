import { NextRequest, NextResponse } from "next/server";
import { meterRequest, usageHeaders, type UsageState } from "@/lib/api-usage";
import { bearerToken, looksLikeApiKey } from "@/lib/api-keys/key";
import {
  findKeyBySecret,
  touchKeyUsage,
  type ApiKeyRecord,
} from "@/lib/server/api-key-repository";

/**
 * Authenticating an API request.
 *
 * The key is never compared as a string. It is hashed once and looked up by
 * that hash, so the cost is a single indexed equality regardless of how many
 * keys exist, and nothing usable is ever read out of storage.
 *
 * A demo key remains available only when no real ones can exist — a
 * deployment with no database — so the published examples work on a fresh
 * clone without leaving a backdoor on a configured one.
 */

/**
 * Only meaningful when there is no database to hold real keys.
 *
 * Deliberately the same shape and length as a generated key, so the published
 * examples exercise the same validation a real key does — a demo credential
 * that skips a check is a demo of the wrong thing.
 */
const DEMO_KEY = "dk_test_0s-MJE_zHjqhAycP8NZcAcjx83CjJRDTFWC_HMhpd_E";

export type AuthResult =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      key: ApiKeyRecord;
      usage: UsageState;
      headers: Record<string, string>;
    };

const unauthorized = (message: string) =>
  NextResponse.json(
    { error: { code: "unauthorized", message } },
    { status: 401 },
  );

/** The stand-in identity for the demo key on an unconfigured deployment. */
function demoRecord(secret: string): ApiKeyRecord {
  return {
    id: "demo",
    ownerId: "demo",
    keyHash: secret,
    keyPrefix: "dk_test_",
    lastFour: secret.slice(-4),
    name: "Demo key",
    planId: "embed-free",
    createdAt: new Date(0).toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
}

export async function authorize(req: NextRequest): Promise<AuthResult> {
  const secret = bearerToken(req.headers.get("authorization"));

  if (!secret) {
    return {
      ok: false,
      response: unauthorized(
        "Missing API key. Pass it as 'Authorization: Bearer dk_live_...'.",
      ),
    };
  }

  // Reject an obviously malformed key before touching storage: it costs
  // nothing and keeps junk traffic off the database.
  if (!looksLikeApiKey(secret)) {
    return { ok: false, response: unauthorized("Invalid API key.") };
  }

  let record = await findKeyBySecret(secret);

  if (!record && secret === DEMO_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    record = demoRecord(secret);
  }

  if (!record) {
    return { ok: false, response: unauthorized("Invalid API key.") };
  }

  // A revoked key is a key the customer has already decided is compromised.
  if (record.revokedAt) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "key_revoked",
            message: "This API key was revoked. Create a new one in your account.",
          },
        },
        { status: 401 },
      ),
    };
  }

  const { state, limitResponse } = meterRequest(record.keyHash, record.planId);
  if (limitResponse) return { ok: false, response: limitResponse };

  // Bookkeeping, not blocking — see touchKeyUsage.
  if (record.id !== "demo") void touchKeyUsage(record);

  return { ok: true, key: record, usage: state, headers: usageHeaders(state) };
}
