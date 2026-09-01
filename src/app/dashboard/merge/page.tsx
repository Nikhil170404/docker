import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import MergeClient from "./MergeClient";

interface TemplateRow {
  id: string;
  title: string;
  description: string;
  content: string | null;
  fields: string;
}

export default async function MergePage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/merge");

  const { template: templateId } = await searchParams;
  const db = getDb();

  const allRows = db.prepare("SELECT id, title, description, fields FROM templates WHERE user_id = ? ORDER BY updated_at DESC").all(session.id) as TemplateRow[];
  const templates = allRows.map((r) => ({ id: r.id, title: r.title, description: r.description, fields: JSON.parse(r.fields ?? "[]") as string[] }));

  let initialContent: string | null = null;
  let initialFields: string[] = [];
  if (templateId) {
    const row = db.prepare("SELECT content, fields FROM templates WHERE id = ? AND user_id = ?").get(templateId, session.id) as Pick<TemplateRow, "content" | "fields"> | undefined;
    if (row) {
      initialContent = row.content;
      initialFields = JSON.parse(row.fields ?? "[]") as string[];
    }
  }

  return (
    <MergeClient
      session={session}
      templates={templates}
      selectedTemplateId={templateId ?? null}
      initialContent={initialContent}
      initialFields={initialFields}
    />
  );
}
