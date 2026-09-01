import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/settings");

  const supabase = await createClient();
  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, label, revoked, created_at")
    .eq("user_id", session.id)
    .order("created_at", { ascending: false });

  return <SettingsClient session={session} apiKeys={keys ?? []} />;
}
