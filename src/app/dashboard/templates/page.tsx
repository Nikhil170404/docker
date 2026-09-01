import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import TemplatesClient from "./TemplatesClient";

export default async function TemplatesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/templates");

  const supabase = await createClient();
  const { data } = await supabase
    .from("templates")
    .select("id, title, description, fields, created_at, updated_at")
    .eq("user_id", session.id)
    .order("updated_at", { ascending: false });

  const templates = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    fields: JSON.parse(r.fields ?? "[]") as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return <TemplatesClient session={session} initialTemplates={templates} />;
}
