import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import ScheduledClient from "./ScheduledClient";

export default async function ScheduledPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/scheduled");

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, template_title, recipient_count, scheduled_for, status, sent_at, error, created_at FROM scheduled_sends WHERE user_id = ? ORDER BY scheduled_for DESC LIMIT 100"
    )
    .all(session.id) as {
    id: string;
    template_title: string;
    recipient_count: number;
    scheduled_for: string;
    status: string;
    sent_at: string | null;
    error: string | null;
    created_at: string;
  }[];

  return <ScheduledClient session={session} rows={rows} />;
}
