import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import MergeClient from "./MergeClient";

export default async function MergePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/merge");

  const { template: templateId } = await searchParams;
  const supabase = await createClient();

  const { data: allRows } = await supabase
    .from("templates")
    .select("id, title, description, fields")
    .eq("user_id", session.id)
    .order("updated_at", { ascending: false });

  const templates = (allRows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    fields: JSON.parse(r.fields ?? "[]") as string[],
  }));

  let initialContent: string | null = null;
  let initialFields: string[] = [];
  if (templateId) {
    const { data: row } = await supabase
      .from("templates")
      .select("content, fields")
      .eq("id", templateId)
      .eq("user_id", session.id)
      .single();
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
