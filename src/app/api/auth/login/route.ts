import { NextRequest, NextResponse } from "next/server";
import { createSession, findUserByEmail, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const user = findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await verifyPassword(body.password, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession({ id: user.id, email: user.email, name: user.name, plan: user.plan });
  return NextResponse.json({ ok: true });
}
