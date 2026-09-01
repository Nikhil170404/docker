import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDocument } from "@/lib/document-store";
import DocEditorWithId from "./DocEditorWithId";

export default async function DocEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/editor/docs/${id}`);

  const doc = await getDocument(id, session.id);
  if (!doc) notFound();

  return <DocEditorWithId doc={doc} />;
}
