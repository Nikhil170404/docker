import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, retryAfterMs } = checkRateLimit(`login:${ip}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: body.email.trim().toLowerCase(),
    password: body.password,
  });

  if (error) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
