import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { generateApiKey } from "@/lib/api-auth";
import { createHmac } from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET ?? "dockaro-api-key-secret-change-in-prod";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const keys = db
    .prepare("SELECT id, label, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC")
    .all(session.id);

  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const label = (body?.label ?? "").toString().trim().slice(0, 64) || "API Key";

  const rawKey = generateApiKey(session.id);
  const keyHash = createHmac("sha256", API_KEY_SECRET).update(rawKey).digest("hex");
  const id = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();

  const db = getDb();
  db.prepare(
    "INSERT INTO api_keys (id, user_id, key_hash, label, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)"
  ).run(id, session.id, keyHash, label, now);

  // Return plaintext key ONCE — never stored
  return NextResponse.json({ id, label, key: rawKey, created_at: now }, { status: 201 });
}
