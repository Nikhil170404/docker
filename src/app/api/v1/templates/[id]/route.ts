import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .eq("user_id", session.id)
    .single();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...data, fields: JSON.parse(data.fields ?? "[]") });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .eq("user_id", session.id)
    .single();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  await supabase
    .from("templates")
    .update({
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      content: body.content !== undefined ? body.content : existing.content,
      fields: body.fields !== undefined ? JSON.stringify(body.fields) : existing.fields,
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", session.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("templates")
    .delete()
    .eq("id", id)
    .eq("user_id", session.id);
  if (error) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
