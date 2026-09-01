"use client";

import { useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Cloud, FolderOpen, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import EditorTopBar from "@/components/editors/EditorTopBar";
import DocumentTitle from "@/components/editors/DocumentTitle";
import WordStatusBar from "@/components/editors/WordStatusBar";
import type { DocsEditorHandle, WordDocumentStatus } from "@/components/editors/DocsEditor";
import type { DocKaroDocument } from "@/lib/document-store";

const DocsEditor = dynamic(() => import("@/components/editors/DocsEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-word-muted">Loading editor…</div>
  ),
});

const INITIAL_STATUS: WordDocumentStatus = {
  name: "Untitled document",
  wordCount: 0,
  pageCount: 1,
  currentPage: 1,
  zoom: 100,
};

export default function DocEditorWithId({ doc }: { doc: DocKaroDocument }) {
  const apiRef = useRef<DocsEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<WordDocumentStatus>({ ...INITIAL_STATUS, name: doc.title });
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");

  const persistPatch = useCallback(
    async (patch: { title?: string; content?: string }) => {
      setSaving("saving");
      await fetch(`/api/v1/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
    },
    [doc.id]
  );

  const handleZoomChange = (zoom: number) => {
    setStatus((s) => ({ ...s, zoom }));
    apiRef.current?.setZoom(zoom);
  };

  const handleRename = (name: string) => {
    apiRef.current?.setName(name);
    void persistPatch({ title: name });
  };

  const handleOpenFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      await apiRef.current?.openDocx(file);
    } catch (err) {
      console.error("Failed to import .docx:", err);
      alert("Could not open the file. Make sure it is a valid .docx document.");
    } finally {
      setImporting(false);
    }
  };

  const saveIcon =
    saving === "saving" ? (
      <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted">
        <Cloud size={13} className="animate-pulse" /> Saving…
      </span>
    ) : saving === "saved" ? (
      <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-green-600">
        <Cloud size={13} /> Saved
      </span>
    ) : (
      <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted" title="Saved">
        <Cloud size={13} /> Saved
      </span>
    );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleFileChange}
      />
      <EditorTopBar
        active="docs"
        center={<DocumentTitle name={status.name} onRename={handleRename} />}
        right={
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted transition-colors hover:bg-black/5 hover:text-word-text"
              title="Back to dashboard"
            >
              <LayoutDashboard size={13} />
              Dashboard
            </Link>
            <button
              onClick={handleOpenFile}
              disabled={importing}
              title="Open a .docx file"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted transition-colors hover:bg-black/5 hover:text-word-text disabled:opacity-50"
            >
              <FolderOpen size={13} />
              {importing ? "Opening…" : "Open"}
            </button>
            {saveIcon}
          </div>
        }
      />
      <div className="word-docs flex min-h-0 flex-1 flex-col overflow-hidden bg-word-canvas">
        <DocsEditor
          apiRef={apiRef}
          onStatusChange={setStatus}
          documentId={doc.id}
          initialContent={doc.content ?? undefined}
          onContentChange={(content) => void persistPatch({ content })}
        />
      </div>
      <WordStatusBar
        currentPage={status.currentPage}
        pageCount={status.pageCount}
        wordCount={status.wordCount}
        zoom={status.zoom}
        onZoomChange={handleZoomChange}
      />
    </>
  );
}
