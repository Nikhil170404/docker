import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, template_title, recipient_count, scheduled_for, status, sent_at, error, created_at FROM scheduled_sends WHERE user_id = ? ORDER BY scheduled_for DESC LIMIT 100"
    )
    .all(session.id);

  return NextResponse.json({ scheduled: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.payload || !body?.scheduledFor) {
    return NextResponse.json({ error: "payload and scheduledFor are required" }, { status: 400 });
  }

  const scheduledFor = new Date(body.scheduledFor);
  if (isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
    return NextResponse.json({ error: "scheduledFor must be a future date" }, { status: 400 });
  }

  const db = getDb();
  const id = `sch_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO scheduled_sends (id, user_id, payload, template_title, recipient_count, scheduled_for, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    id, session.id,
    typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload),
    body.templateTitle ?? "",
    body.recipientCount ?? 0,
    scheduledFor.toISOString(),
    now
  );

  return NextResponse.json({ id }, { status: 201 });
}
