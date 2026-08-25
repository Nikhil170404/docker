import type { Metadata } from "next";
import EmbedHost from "@/components/editors/EmbedHost";
import { parseEmbedMode } from "@/lib/embed/protocol";

/**
 * The embeddable editor. This is the URL the SDK puts in an iframe, and the
 * one `editUrl` on an API-created document points at.
 *
 * `?mode=richtext` is a continuous-flow editor that gives back HTML — the
 * job CKEditor and TinyMCE do. `?mode=document` is the paginated Word
 * surface that gives back .docx — the job ONLYOFFICE does. Same engine,
 * same document model, one integration.
 */
export const metadata: Metadata = {
  title: "DocKaro Editor",
  // An embedded editor is a widget inside someone else's page; it has no
  // business appearing in search results on its own.
  robots: { index: false, follow: false },
};

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;

  return (
    <div className="fixed inset-0 flex flex-col">
      <EmbedHost documentId={id} mode={parseEmbedMode(mode)} />
    </div>
  );
}
