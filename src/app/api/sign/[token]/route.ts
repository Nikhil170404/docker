import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.sigDataUrl) {
    return NextResponse.json({ error: "Missing signature data" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("sign_requests")
    .select("id, status, expires_at")
    .eq("doc_token", token)
    .single();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status === "signed") return NextResponse.json({ error: "Already signed" }, { status: 409 });
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const now = new Date().toISOString();

  await admin
    .from("sign_requests")
    .update({ status: "signed", sig_data_url: body.sigDataUrl, ip_address: ip, signed_at: now })
    .eq("doc_token", token);

  return NextResponse.json({ ok: true });
}
