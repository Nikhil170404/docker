import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM templates WHERE id = ? AND user_id = ?").get(id, session.id) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...row, fields: JSON.parse(row.fields as string ?? "[]") });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM templates WHERE id = ? AND user_id = ?").get(id, session.id) as Record<string, unknown> | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  db.prepare("UPDATE templates SET title = ?, description = ?, content = ?, fields = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    body.title ?? existing.title,
    body.description ?? existing.description,
    body.content !== undefined ? body.content : existing.content,
    body.fields !== undefined ? JSON.stringify(body.fields) : existing.fields,
    now, id, session.id
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM templates WHERE id = ? AND user_id = ?").run(id, session.id);
  if (!result.changes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
