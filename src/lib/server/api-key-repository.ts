import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { adminClient, isDatabaseConfigured } from "./supabase-admin";
import { generateApiKey, hashApiKey, type KeyEnvironment } from "@/lib/api-keys/key";

/**
 * Where API keys live.
 *
 * Postgres when Supabase is configured, a directory of JSON files otherwise —
 * the same fallback the document store uses, for the same reason: a clone
 * with no credentials has to run.
 *
 * Records are indexed by hash in both backends, so authenticating a request
 * is one equality lookup rather than a scan over candidate keys. That is the
 * only operation on this table that happens on every single API call, so it
 * is the only one whose cost matters.
 */

export interface ApiKeyRecord {
  id: string;
  ownerId: string;
  keyHash: string;
  keyPrefix: string;
  lastFour: string;
  name: string;
  planId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** What a customer sees. Never includes the hash or the secret. */
export interface ApiKeySummary {
  id: string;
  name: string;
  planId: string;
  masked: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

const keysDir = () =>
  process.env.DOCKARO_KEYS_DIR ?? join(process.cwd(), ".data", "api-keys");

/* ------------------------------------------------------------------ */
/* Filesystem backend                                                  */
/* ------------------------------------------------------------------ */

/** Hash is hex, so it is already a safe file name — but check anyway. */
function hashPath(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error("Refusing to build a path for a malformed key hash.");
  }
  return join(keysDir(), `${hash}.json`);
}

async function fsWrite(record: ApiKeyRecord): Promise<void> {
  await mkdir(keysDir(), { recursive: true });
  const target = hashPath(record.keyHash);
  const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(record), "utf8");
  await rename(temp, target);
}

async function fsReadByHash(hash: string): Promise<ApiKeyRecord | null> {
  try {
    return JSON.parse(await readFile(hashPath(hash), "utf8")) as ApiKeyRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function fsListByOwner(ownerId: string): Promise<ApiKeyRecord[]> {
  await mkdir(keysDir(), { recursive: true });
  const names = (await readdir(keysDir())).filter((n) => n.endsWith(".json"));
  const records = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(
          await readFile(join(keysDir(), name), "utf8"),
        ) as ApiKeyRecord;
      } catch {
        return null;
      }
    }),
  );
  return records
    .filter((r): r is ApiKeyRecord => r?.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ------------------------------------------------------------------ */
/* Public operations                                                   */
/* ------------------------------------------------------------------ */

export interface CreatedKey {
  /** Shown once, then unrecoverable. */
  secret: string;
  summary: ApiKeySummary;
}

export async function createApiKey(input: {
  ownerId: string;
  name?: string;
  planId?: string;
  environment?: KeyEnvironment;
}): Promise<CreatedKey> {
  const generated = generateApiKey(input.environment ?? "live");
  const record: ApiKeyRecord = {
    id: randomUUID(),
    ownerId: input.ownerId,
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    lastFour: generated.lastFour,
    name: input.name?.trim() || "Default key",
    planId: input.planId ?? "embed-free",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };

  const db = isDatabaseConfigured() ? adminClient() : null;
  if (db) {
    const { error } = await db.from("api_keys").insert({
      id: record.id,
      owner_id: record.ownerId,
      key_hash: record.keyHash,
      key_prefix: record.keyPrefix,
      last_four: record.lastFour,
      name: record.name,
      plan_id: record.planId,
    });
    if (error) throw new Error(`Could not create API key: ${error.message}`);
  } else {
    await fsWrite(record);
  }

  return { secret: generated.secret, summary: toSummary(record) };
}

/**
 * Looks a key up by its secret. One indexed equality lookup on the hash —
 * the secret itself is never compared, stored, or logged.
 */
export async function findKeyBySecret(secret: string): Promise<ApiKeyRecord | null> {
  const hash = hashApiKey(secret);

  const db = isDatabaseConfigured() ? adminClient() : null;
  if (db) {
    const { data, error } = await db
      .from("api_keys")
      .select("*")
      .eq("key_hash", hash)
      .maybeSingle();
    if (error || !data) return null;
    return fromRow(data);
  }

  return fsReadByHash(hash);
}

export async function listApiKeys(ownerId: string): Promise<ApiKeySummary[]> {
  const db = isDatabaseConfigured() ? adminClient() : null;
  if (db) {
    const { data, error } = await db
      .from("api_keys")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    return data.map((row) => toSummary(fromRow(row)));
  }

  return (await fsListByOwner(ownerId)).map(toSummary);
}

/** Revoking keeps the row: an audit trail is worth more than a tidy table. */
export async function revokeApiKey(
  ownerId: string,
  keyId: string,
): Promise<boolean> {
  const revokedAt = new Date().toISOString();

  const db = isDatabaseConfigured() ? adminClient() : null;
  if (db) {
    const { data, error } = await db
      .from("api_keys")
      .update({ revoked_at: revokedAt })
      // Scoped to the owner so one customer cannot revoke another's key.
      .eq("id", keyId)
      .eq("owner_id", ownerId)
      .is("revoked_at", null)
      .select("id");
    return !error && (data?.length ?? 0) > 0;
  }

  const records = await fsListByOwner(ownerId);
  const target = records.find((r) => r.id === keyId && !r.revokedAt);
  if (!target) return false;
  await fsWrite({ ...target, revokedAt });
  return true;
}

/**
 * Records that a key was used.
 *
 * Deliberately fire-and-forget: an API request must not fail, or wait, on a
 * bookkeeping write. A last-used timestamp that is a few seconds stale costs
 * nothing; a request that 500s because a write blocked costs a customer.
 */
export async function touchKeyUsage(record: ApiKeyRecord): Promise<void> {
  const lastUsedAt = new Date().toISOString();

  const db = isDatabaseConfigured() ? adminClient() : null;
  if (db) {
    void db
      .from("api_keys")
      .update({ last_used_at: lastUsedAt })
      .eq("key_hash", record.keyHash)
      .then(undefined, () => undefined);
    return;
  }

  void fsWrite({ ...record, lastUsedAt }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

function fromRow(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    keyHash: String(row.key_hash),
    keyPrefix: String(row.key_prefix),
    lastFour: String(row.last_four),
    name: String(row.name),
    planId: String(row.plan_id),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
  };
}

export function toSummary(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: record.id,
    name: record.name,
    planId: record.planId,
    masked: `${record.keyPrefix}${"•".repeat(8)}${record.lastFour}`,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revoked: record.revokedAt !== null,
  };
}
