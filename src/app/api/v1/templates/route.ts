import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

interface TemplateRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  content: string | null;
  fields: string;
  created_at: string;
  updated_at: string;
}

function mapRow(r: TemplateRow) {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description,
    content: r.content,
    fields: JSON.parse(r.fields ?? "[]") as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const rows = db.prepare("SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC").all(session.id) as TemplateRow[];
  return NextResponse.json({ data: rows.map(mapRow) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const db = getDb();
  const id = `tpl_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const fields = JSON.stringify(Array.isArray(body.fields) ? body.fields : []);
  db.prepare(
    "INSERT INTO templates (id, user_id, title, description, content, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, session.id, body.title, body.description ?? "", body.content ?? null, fields, now, now);
  return NextResponse.json({ id, userId: session.id, title: body.title, description: body.description ?? "", content: body.content ?? null, fields: body.fields ?? [], createdAt: now, updatedAt: now }, { status: 201 });
}
