import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, retryAfterMs } = checkRateLimit(`signup:${ip}`, 5, 3_600_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    typeof body.name !== "string"
  ) {
    return NextResponse.json({ error: "name, email and password are required" }, { status: 400 });
  }

  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();
  const password = body.password;

  if (!email.includes("@") || password.length < 8) {
    return NextResponse.json(
      { error: "Invalid email or password too short (min 8 chars)" },
      { status: 400 }
    );
  }
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      return NextResponse.json(
        { error: "An account with that email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
