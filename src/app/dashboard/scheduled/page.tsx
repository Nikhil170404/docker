import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ScheduledClient from "./ScheduledClient";

export default async function ScheduledPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/scheduled");

  const supabase = await createClient();
  const { data } = await supabase
    .from("scheduled_sends")
    .select("id, template_title, recipient_count, scheduled_for, status, sent_at, error, created_at")
    .eq("user_id", session.id)
    .order("scheduled_for", { ascending: false })
    .limit(100);

  return <ScheduledClient session={session} rows={data ?? []} />;
}
