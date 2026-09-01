import { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";
import { createHmac } from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET ?? "dockaro-api-key-secret-change-in-prod";

export function generateApiKey(userId: string): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  const sig = createHmac("sha256", API_KEY_SECRET).update(`${userId}:${raw}`).digest("hex").slice(0, 16);
  return `dk_live_${raw}${sig}`;
}

export function requireApiKey(req: NextRequest): NextResponse | null {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!key) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Missing API key. Pass it as 'Authorization: Bearer dk_live_...'." } },
      { status: 401 }
    );
  }

  const db = getDb();
  const row = db.prepare("SELECT user_id FROM api_keys WHERE key_hash = ? AND revoked = 0").get(
    createHmac("sha256", API_KEY_SECRET).update(key).digest("hex")
  ) as { user_id: string } | undefined;

  if (!row) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid or revoked API key." } },
      { status: 401 }
    );
  }

  return null;
}
