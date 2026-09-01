import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const { data } = await supabase
    .from("templates")
    .select("*")
    .eq("user_id", session.id)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description,
    content: r.content,
    fields: JSON.parse(r.fields ?? "[]") as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const id = `tpl_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const fields = JSON.stringify(Array.isArray(body.fields) ? body.fields : []);
  await supabase.from("templates").insert({
    id,
    user_id: session.id,
    title: body.title,
    description: body.description ?? "",
    content: body.content ?? null,
    fields,
    created_at: now,
    updated_at: now,
  });
  return NextResponse.json(
    {
      id,
      userId: session.id,
      title: body.title,
      description: body.description ?? "",
      content: body.content ?? null,
      fields: body.fields ?? [],
      createdAt: now,
      updatedAt: now,
    },
    { status: 201 }
  );
}
