import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import TemplatesClient from "./TemplatesClient";

interface TemplateRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  content: string | null;
  fields: string;
  created_at: string;
  updated_at: string;
}

export default async function TemplatesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/templates");

  const db = getDb();
  const rows = db.prepare("SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC").all(session.id) as TemplateRow[];
  const templates = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    fields: JSON.parse(r.fields ?? "[]") as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return <TemplatesClient session={session} initialTemplates={templates} />;
}
