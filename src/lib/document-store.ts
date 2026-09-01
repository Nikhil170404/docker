import { createClient } from "@/lib/supabase/server";

export type DocKaroDocument = {
  id: string;
  userId: string;
  type: "docx" | "xlsx";
  title: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
};

function row(r: Record<string, unknown>): DocKaroDocument {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    type: r.type as "docx" | "xlsx",
    title: r.title as string,
    content: r.content as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function createDocument(
  userId: string,
  input: { type: "docx" | "xlsx"; title: string; content?: string }
): Promise<DocKaroDocument> {
  const supabase = await createClient();
  const id = `doc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  await supabase.from("documents").insert({
    id,
    user_id: userId,
    type: input.type,
    title: input.title,
    content: input.content ?? null,
    created_at: now,
    updated_at: now,
  });
  return { id, userId, type: input.type, title: input.title, content: input.content ?? null, createdAt: now, updatedAt: now };
}

export async function listDocuments(userId: string): Promise<DocKaroDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => row(r as Record<string, unknown>));
}

export async function getDocument(id: string, userId?: string): Promise<DocKaroDocument | null> {
  const supabase = await createClient();
  let query = supabase.from("documents").select("*").eq("id", id);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.single();
  return data ? row(data as Record<string, unknown>) : null;
}

export async function updateDocument(
  id: string,
  userId: string,
  patch: Partial<Pick<DocKaroDocument, "title" | "content">>
): Promise<DocKaroDocument | null> {
  const supabase = await createClient();
  const existing = await getDocument(id, userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  await supabase
    .from("documents")
    .update({
      title: patch.title ?? existing.title,
      content: "content" in patch ? patch.content : existing.content,
      updated_at: now,
    })
    .eq("id", id)
    .eq("user_id", userId);
  return { ...existing, ...patch, updatedAt: now };
}

export async function deleteDocument(id: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  return !error;
}
