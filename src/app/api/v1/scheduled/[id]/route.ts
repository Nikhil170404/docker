import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("scheduled_sends")
    .select("user_id, status")
    .eq("id", id)
    .single();

  if (!data || data.user_id !== session.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (data.status !== "pending") {
    return NextResponse.json({ error: "Can only cancel pending sends" }, { status: 409 });
  }

  await supabase
    .from("scheduled_sends")
    .update({ status: "cancelled" })
    .eq("id", id);
  return NextResponse.json({ ok: true });
}
