import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import HistoryClient from "./HistoryClient";

interface LogRow {
  id: string;
  template_id: string | null;
  recipient: string;
  subject: string;
  status: string;
  provider: string;
  sent_at: string;
  view_count: number | null;
  first_viewed_at: string | null;
}

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/history");

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.id, l.template_id, l.recipient, l.subject, l.status, l.provider, l.sent_at,
              ev.view_count, ev.first_viewed_at
       FROM send_logs l
       LEFT JOIN email_views ev ON ev.log_id = l.id
       WHERE l.user_id = ?
       ORDER BY l.sent_at DESC
       LIMIT 500`
    )
    .all(session.id) as LogRow[];

  const logs = rows.map((r) => ({
    id: r.id,
    templateId: r.template_id,
    recipient: r.recipient,
    subject: r.subject,
    status: r.status,
    provider: r.provider,
    sentAt: r.sent_at,
    viewCount: r.view_count ?? 0,
    firstViewedAt: r.first_viewed_at ?? null,
  }));

  return <HistoryClient session={session} logs={logs} />;
}
