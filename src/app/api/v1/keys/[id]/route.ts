import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT user_id FROM api_keys WHERE id = ?").get(id) as { user_id: string } | undefined;
  if (!row || row.user_id !== session.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
