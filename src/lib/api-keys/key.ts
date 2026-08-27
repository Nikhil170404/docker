import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API key format and hashing.
 *
 * Three decisions worth stating, because each has a wrong answer that looks
 * reasonable:
 *
 * 1. **SHA-256, not bcrypt.** Password hashing is deliberately slow to make
 *    guessing a human-chosen secret expensive. This secret is 32 random
 *    bytes — 256 bits of entropy that no amount of guessing will reach — so
 *    slowness buys nothing and costs everything: bcrypt at a sane work
 *    factor is ~100ms, and this hash runs on *every* API request. SHA-256 is
 *    microseconds and just as unguessable here.
 *
 * 2. **Only the hash is stored.** The secret is shown once, at creation. A
 *    leaked database is then an inconvenience rather than a set of live
 *    credentials, and no support process can ever "look up" a key.
 *
 * 3. **A prefix outside the secret.** `dk_live_` / `dk_test_` lets secret
 *    scanners recognise a leaked key in a commit, and lets us reject an
 *    obviously malformed key before touching the database.
 */

export type KeyEnvironment = "live" | "test";

const PREFIXES: Record<KeyEnvironment, string> = {
  live: "dk_live_",
  test: "dk_test_",
};

/** 32 bytes: comfortably past any brute-force horizon, still a short string. */
const SECRET_BYTES = 32;

/** Enough of the tail to recognise a key in a list; far too little to use. */
const LAST_FOUR = 4;

export interface GeneratedKey {
  /** Shown to the customer exactly once. */
  secret: string;
  hash: string;
  prefix: string;
  lastFour: string;
}

export function generateApiKey(environment: KeyEnvironment = "live"): GeneratedKey {
  const prefix = PREFIXES[environment];
  // base64url: URL- and header-safe, and denser than hex, so the key stays
  // short enough that people will actually paste it correctly.
  const secret = prefix + randomBytes(SECRET_BYTES).toString("base64url");

  return {
    secret,
    hash: hashApiKey(secret),
    prefix,
    lastFour: secret.slice(-LAST_FOUR),
  };
}

/**
 * The lookup key for a secret.
 *
 * Hashing turns authentication into a single indexed equality lookup, which
 * is the whole optimisation: no scanning a table of keys, no comparing
 * candidates one by one, and the database never holds anything usable.
 */
export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Cheap structural check before any database work. */
export function looksLikeApiKey(value: string): boolean {
  const environment = keyEnvironment(value);
  if (!environment) return false;

  const body = value.slice(PREFIXES[environment].length);
  // base64url alphabet, and long enough to be a real secret rather than a
  // prefix somebody typed by hand.
  return /^[A-Za-z0-9_-]{32,}$/.test(body);
}

export function keyEnvironment(value: string): KeyEnvironment | null {
  for (const [environment, prefix] of Object.entries(PREFIXES)) {
    if (value.startsWith(prefix)) return environment as KeyEnvironment;
  }
  return null;
}

/**
 * Constant-time hash comparison, for the code paths that compare a computed
 * hash to a stored one in memory rather than through an indexed lookup.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** How a key is shown in a list: recognisable, unusable. */
export function maskKey(prefix: string, lastFour: string): string {
  return `${prefix}${"•".repeat(8)}${lastFour}`;
}

/** Bearer token out of an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
