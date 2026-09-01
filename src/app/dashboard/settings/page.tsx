import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/settings");

  const db = getDb();
  const keys = db
    .prepare("SELECT id, label, revoked, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC")
    .all(session.id) as { id: string; label: string; revoked: number; created_at: string }[];

  return <SettingsClient session={session} apiKeys={keys} />;
}
