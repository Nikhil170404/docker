"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Cloud, FolderOpen } from "lucide-react";
import EditorTopBar from "@/components/editors/EditorTopBar";
import DocumentTitle from "@/components/editors/DocumentTitle";
import WordStatusBar from "@/components/editors/WordStatusBar";
import type { DocsEditorHandle, WordDocumentStatus } from "@/components/editors/DocsEditor";

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

export default function DocsEditorPage() {
  const apiRef = useRef<DocsEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<WordDocumentStatus>(INITIAL_STATUS);
  const [importing, setImporting] = useState(false);

  const handleZoomChange = (zoom: number) => {
    setStatus((current) => ({ ...current, zoom }));
    apiRef.current?.setZoom(zoom);
  };

  const handleOpenFile = () => {
    fileInputRef.current?.click();
  };

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
        center={<DocumentTitle name={status.name} onRename={(name) => apiRef.current?.setName(name)} />}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenFile}
              disabled={importing}
              title="Open a .docx file"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted transition-colors hover:bg-black/5 hover:text-word-text disabled:opacity-50"
            >
              <FolderOpen size={13} />
              {importing ? "Opening…" : "Open"}
            </button>
            <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted" title="Saved in this browser">
              <Cloud size={13} /> Saved
            </span>
          </div>
        }
      />
      <div className="word-docs flex min-h-0 flex-1 flex-col overflow-hidden bg-word-canvas">
        <DocsEditor apiRef={apiRef} onStatusChange={setStatus} />
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
