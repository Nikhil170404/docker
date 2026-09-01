import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.sigDataUrl) {
    return NextResponse.json({ error: "Missing signature data" }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, status, expires_at FROM sign_requests WHERE doc_token = ?")
    .get(token) as { id: string; status: string; expires_at: string } | undefined;

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status === "signed") return NextResponse.json({ error: "Already signed" }, { status: 409 });
  if (new Date(row.expires_at) < new Date()) return NextResponse.json({ error: "Link expired" }, { status: 410 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const now = new Date().toISOString();

  db.prepare(
    "UPDATE sign_requests SET status = 'signed', sig_data_url = ?, ip_address = ?, signed_at = ? WHERE doc_token = ?"
  ).run(body.sigDataUrl, ip, now, token);

  return NextResponse.json({ ok: true });
}
