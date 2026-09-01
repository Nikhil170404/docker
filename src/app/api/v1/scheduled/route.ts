import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("scheduled_sends")
    .select("id, template_title, recipient_count, scheduled_for, status, sent_at, error, created_at")
    .eq("user_id", session.id)
    .order("scheduled_for", { ascending: false })
    .limit(100);

  return NextResponse.json({ scheduled: data ?? [] });
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

  const supabase = await createClient();
  const id = `sch_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();

  await supabase.from("scheduled_sends").insert({
    id,
    user_id: session.id,
    payload: typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload),
    template_title: body.templateTitle ?? "",
    recipient_count: body.recipientCount ?? 0,
    scheduled_for: scheduledFor.toISOString(),
    status: "pending",
    created_at: now,
  });

  return NextResponse.json({ id }, { status: 201 });
}
