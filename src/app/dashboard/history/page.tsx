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
}

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/history");

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, template_id, recipient, subject, status, provider, sent_at FROM send_logs WHERE user_id = ? ORDER BY sent_at DESC LIMIT 500"
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
  }));

  return <HistoryClient session={session} logs={logs} />;
}
