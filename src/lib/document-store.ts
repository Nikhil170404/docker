import { getDb } from "./db";

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

export function createDocument(userId: string, input: { type: "docx" | "xlsx"; title: string; content?: string }) {
  const db = getDb();
  const id = `doc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO documents (id, user_id, type, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, userId, input.type, input.title, input.content ?? null, now, now);
  return { id, userId, type: input.type, title: input.title, content: input.content ?? null, createdAt: now, updatedAt: now };
}

export function listDocuments(userId: string): DocKaroDocument[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as Record<string, unknown>[];
  return rows.map(row);
}

export function getDocument(id: string, userId?: string): DocKaroDocument | null {
  const db = getDb();
  const r = userId
    ? (db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").get(id, userId) as Record<string, unknown> | undefined)
    : (db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined);
  return r ? row(r) : null;
}

export function updateDocument(
  id: string,
  userId: string,
  patch: Partial<Pick<DocKaroDocument, "title" | "content">>
): DocKaroDocument | null {
  const db = getDb();
  const existing = getDocument(id, userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    patch.title ?? existing.title,
    "content" in patch ? patch.content : existing.content,
    now,
    id,
    userId
  );
  return { ...existing, ...patch, updatedAt: now };
}

export function deleteDocument(id: string, userId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}
