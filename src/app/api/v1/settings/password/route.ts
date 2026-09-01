import { NextRequest, NextResponse } from "next/server";
import { getSession, hashPassword, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.currentPassword || !body?.newPassword) {
    return NextResponse.json({ error: "currentPassword and newPassword are required" }, { status: 400 });
  }
  if (body.newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT password FROM users WHERE id = ?").get(session.id) as { password: string } | undefined;
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const valid = await verifyPassword(body.currentPassword, user.password);
  if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });

  const newHash = await hashPassword(body.newPassword);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(newHash, session.id);
  return NextResponse.json({ ok: true });
}
