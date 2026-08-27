import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bearerToken,
  generateApiKey,
  hashApiKey,
  hashesMatch,
  keyEnvironment,
  looksLikeApiKey,
  maskKey,
} from "@/lib/api-keys/key";

const KEYS_DIR = mkdtempSync(join(tmpdir(), "dockaro-keys-"));
process.env.DOCKARO_KEYS_DIR = KEYS_DIR;

const repo = await import("@/lib/server/api-key-repository");

beforeEach(() => {
  for (const name of readdirSync(KEYS_DIR)) rmSync(join(KEYS_DIR, name), { force: true });
});
afterAll(() => rmSync(KEYS_DIR, { recursive: true, force: true }));

describe("key generation", () => {
  it("produces a prefixed, high-entropy secret", () => {
    const key = generateApiKey("live");
    expect(key.secret.startsWith("dk_live_")).toBe(true);
    // 32 random bytes in base64url is 43 characters.
    expect(key.secret.length).toBeGreaterThanOrEqual("dk_live_".length + 43);
    expect(key.lastFour).toBe(key.secret.slice(-4));
  });

  it("never repeats", () => {
    const secrets = new Set(
      Array.from({ length: 500 }, () => generateApiKey().secret),
    );
    expect(secrets.size).toBe(500);
  });

  it("distinguishes live from test keys", () => {
    expect(keyEnvironment(generateApiKey("live").secret)).toBe("live");
    expect(keyEnvironment(generateApiKey("test").secret)).toBe("test");
    expect(keyEnvironment("sk_live_whatever")).toBeNull();
  });

  it("uses only URL- and header-safe characters", () => {
    // A key is pasted into an Authorization header and sometimes a URL; a
    // stray '+' or '/' would be mangled by something along the way.
    for (let i = 0; i < 200; i++) {
      expect(generateApiKey().secret).toMatch(/^dk_(live|test)_[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hashing", () => {
  it("stores a SHA-256 digest, not the secret", () => {
    const key = generateApiKey();
    expect(key.hash).toBe(createHash("sha256").update(key.secret).digest("hex"));
    expect(key.hash).not.toContain(key.secret);
    expect(key.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic, which is what makes lookup an indexed equality", () => {
    const secret = generateApiKey().secret;
    expect(hashApiKey(secret)).toBe(hashApiKey(secret));
  });

  it("changes completely for a one-character difference", () => {
    const secret = generateApiKey().secret;
    const almost = `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
    expect(hashApiKey(almost)).not.toBe(hashApiKey(secret));
  });

  it("compares hashes without leaking length or content", () => {
    const a = hashApiKey("one");
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, hashApiKey("two"))).toBe(false);
    expect(hashesMatch(a, a.slice(0, -1))).toBe(false);
  });
});

describe("structural validation", () => {
  it("accepts real keys", () => {
    expect(looksLikeApiKey(generateApiKey("live").secret)).toBe(true);
    expect(looksLikeApiKey(generateApiKey("test").secret)).toBe(true);
  });

  it("rejects junk before any database work happens", () => {
    for (const value of [
      "",
      "dk_live_",
      "dk_live_short",
      "Bearer dk_live_xxx",
      "dk_live_has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaa",
      "dk_live_has+plus/slash=aaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "random-string-with-no-prefix",
    ]) {
      expect(looksLikeApiKey(value), value).toBe(false);
    }
  });

  it("masks a key into something recognisable but unusable", () => {
    const key = generateApiKey("live");
    const masked = maskKey(key.prefix, key.lastFour);
    expect(masked.startsWith("dk_live_")).toBe(true);
    expect(masked.endsWith(key.lastFour)).toBe(true);
    expect(masked).not.toContain(key.secret.slice(8, 20));
  });
});

describe("bearer parsing", () => {
  it("extracts the token", () => {
    expect(bearerToken("Bearer dk_live_abc")).toBe("dk_live_abc");
    expect(bearerToken("Bearer  dk_live_abc  ")).toBe("dk_live_abc");
  });

  it("refuses anything that is not a bearer header", () => {
    for (const header of [null, "", "Basic abc", "bearer abc", "Bearer", "Bearer   "]) {
      expect(bearerToken(header)).toBeNull();
    }
  });
});

describe("repository", () => {
  it("returns the secret once and stores only its hash", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1", name: "CI" });

    expect(created.secret.startsWith("dk_live_")).toBe(true);
    expect(created.summary.masked).not.toBe(created.secret);

    // Nothing written to disk may contain the secret itself.
    const files = readdirSync(KEYS_DIR).map((n) => join(KEYS_DIR, n));
    const contents = files.map((f) => readFileSync(f, "utf8")).join("");
    expect(contents).not.toContain(created.secret);
    expect(contents).toContain(hashApiKey(created.secret));
  });

  it("finds a key by its secret", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1" });
    const found = await repo.findKeyBySecret(created.secret);
    expect(found?.ownerId).toBe("user-1");
  });

  it("does not find a key that was never created", async () => {
    expect(await repo.findKeyBySecret(generateApiKey().secret)).toBeNull();
  });

  it("lists only the owner's keys", async () => {
    await repo.createApiKey({ ownerId: "user-1", name: "Mine" });
    await repo.createApiKey({ ownerId: "user-2", name: "Theirs" });

    const mine = await repo.listApiKeys("user-1");
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("Mine");
  });

  it("never exposes the hash in a summary", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1" });
    const [summary] = await repo.listApiKeys("user-1");
    expect(JSON.stringify(summary)).not.toContain(hashApiKey(created.secret));
  });

  it("revokes a key, and keeps the row as an audit trail", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1" });
    expect(await repo.revokeApiKey("user-1", created.summary.id)).toBe(true);

    const [summary] = await repo.listApiKeys("user-1");
    expect(summary.revoked).toBe(true);

    // Still findable, so the auth path can say "revoked" rather than
    // "invalid" — a materially more useful error for a customer.
    const found = await repo.findKeyBySecret(created.secret);
    expect(found?.revokedAt).toBeTruthy();
  });

  it("will not let one owner revoke another's key", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1" });
    expect(await repo.revokeApiKey("user-2", created.summary.id)).toBe(false);
    expect((await repo.listApiKeys("user-1"))[0].revoked).toBe(false);
  });

  it("is idempotent about revoking twice", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1" });
    expect(await repo.revokeApiKey("user-1", created.summary.id)).toBe(true);
    expect(await repo.revokeApiKey("user-1", created.summary.id)).toBe(false);
  });

  it("defaults a key to the free plan", async () => {
    const created = await repo.createApiKey({ ownerId: "user-1" });
    expect(created.summary.planId).toBe("embed-free");
  });

  it("carries a paid plan onto the key", async () => {
    const created = await repo.createApiKey({
      ownerId: "user-1",
      planId: "embed-growth",
    });
    expect((await repo.findKeyBySecret(created.secret))!.planId).toBe("embed-growth");
  });
});
