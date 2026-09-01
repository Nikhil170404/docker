import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import HistoryClient from "./HistoryClient";

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/history");

  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("send_logs")
    .select(`
      id, template_id, recipient, subject, status, provider, sent_at,
      email_views!email_views_log_id_fkey(view_count, first_viewed_at)
    `)
    .eq("user_id", session.id)
    .order("sent_at", { ascending: false })
    .limit(500);

  const mapped = (logs ?? []).map((r) => {
    const ev = Array.isArray(r.email_views) ? r.email_views[0] : null;
    return {
      id: r.id,
      templateId: r.template_id,
      recipient: r.recipient,
      subject: r.subject,
      status: r.status,
      provider: r.provider,
      sentAt: r.sent_at,
      viewCount: ev?.view_count ?? 0,
      firstViewedAt: ev?.first_viewed_at ?? null,
    };
  });

  return <HistoryClient session={session} logs={mapped} />;
}
