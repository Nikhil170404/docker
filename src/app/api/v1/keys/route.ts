import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-auth";
import { createHmac } from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET ?? "dockaro-api-key-secret-change-in-prod";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const { data } = await supabase
    .from("api_keys")
    .select("id, label, revoked, created_at")
    .eq("user_id", session.id)
    .order("created_at", { ascending: false });
  return NextResponse.json({ keys: data ?? [] });
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

  const supabase = await createClient();
  await supabase.from("api_keys").insert({
    id,
    user_id: session.id,
    key_hash: keyHash,
    label,
    revoked: 0,
    created_at: now,
  });

  return NextResponse.json({ id, label, key: rawKey, created_at: now }, { status: 201 });
}
