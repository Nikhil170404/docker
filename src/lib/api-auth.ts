import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "./supabase/admin";
import { createHmac } from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET ?? "dockaro-api-key-secret-change-in-prod";

export function generateApiKey(userId: string): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  const sig = createHmac("sha256", API_KEY_SECRET)
    .update(`${userId}:${raw}`)
    .digest("hex")
    .slice(0, 16);
  return `dk_live_${raw}${sig}`;
}

export async function requireApiKey(req: NextRequest): Promise<NextResponse | null> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!key) {
    return NextResponse.json(
      {
        error: {
          code: "unauthorized",
          message: "Missing API key. Pass it as 'Authorization: Bearer dk_live_...'.",
        },
      },
      { status: 401 }
    );
  }

  const admin = createAdminClient();
  const keyHash = createHmac("sha256", API_KEY_SECRET).update(key).digest("hex");
  const { data: row } = await admin
    .from("api_keys")
    .select("user_id")
    .eq("key_hash", keyHash)
    .eq("revoked", 0)
    .single();

  if (!row) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Invalid or revoked API key." } },
      { status: 401 }
    );
  }

  return null;
}
