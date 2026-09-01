import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const supabase = await createClient();
  await supabase.from("profiles").update({ name }).eq("id", session.id);
  return NextResponse.json({ ok: true });
}
