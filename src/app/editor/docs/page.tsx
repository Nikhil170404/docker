"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Cloud, Eye, FileDown } from "lucide-react";
import EditorTopBar from "@/components/editors/EditorTopBar";
import DocumentTitle from "@/components/editors/DocumentTitle";
import WordStatusBar from "@/components/editors/WordStatusBar";
import type { DocsEditorHandle, WordDocumentStatus } from "@/components/editors/DocsEditor";
import type { FidelityDocEditorHandle } from "@/components/editors/FidelityDocEditor";
import {
  type EditorMode,
  loadEditorMode,
  loadFidelityDoc,
  saveEditorMode,
  saveFidelityDoc,
} from "@/lib/fidelity/persistence";

const DocsEditor = dynamic(() => import("@/components/editors/DocsEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-word-muted">Loading editor…</div>
  ),
});

const FidelityDocEditor = dynamic(() => import("@/components/editors/FidelityDocEditor"), {
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
  const fidelityApiRef = useRef<FidelityDocEditorHandle | null>(null);
  const [status, setStatus] = useState<WordDocumentStatus>(INITIAL_STATUS);

  // Reading localStorage in these lazy initializers can return a
  // different value on the server (always "univer", no `window`) than on
  // the client's first render — normally a hydration-mismatch risk, but
  // harmless here specifically because the JSX below never renders
  // anything mode-dependent until `mounted` flips true, which is
  // guaranteed false on both the server's and the client's very first
  // pass. The rendered DOM is identical either way; only this internal
  // state value differs, and React only compares the former.
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<EditorMode>(() => (typeof window === "undefined" ? "univer" : loadEditorMode()));
  const [fidelityHtml, setFidelityHtml] = useState(() =>
    typeof window === "undefined" ? "" : (loadFidelityDoc()?.html ?? ""),
  );

  useEffect(() => {
    // The canonical hydration-safe "client has taken over" flag — this
    // project's react-hooks/set-state-in-effect rule flags any setState
    // in an effect regardless of context, but there is no render-only
    // substitute for "the DOM the server sent has now been hydrated";
    // React's own docs list synchronizing with an external system (here,
    // whether we're past hydration at all) as a legitimate effect use.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Reflect a zoom change immediately: the document's own value only comes
  // back on the next (debounced) status refresh, and a slider that lags
  // behind the drag feels broken.
  const handleZoomChange = (zoom: number) => {
    setStatus((current) => ({ ...current, zoom }));
    if (mode === "univer") apiRef.current?.setZoom(zoom);
    else fidelityApiRef.current?.setZoom(zoom);
  };

  const handleRename = (name: string) => {
    if (mode === "univer") apiRef.current?.setName(name);
    else fidelityApiRef.current?.setName(name);
  };

  // "Keep Formatting" on a Word/Google Docs paste hands cleaned HTML here
  // instead of converting it through Univer's document model — see
  // DocsEditor's onRichPasteDetected prop doc for why. This switches the
  // whole current document into fidelity mode, one-way, as decided.
  const handleRichPasteDetected = (html: string) => {
    setFidelityHtml(html);
    setMode("fidelity");
    saveEditorMode("fidelity");
    saveFidelityDoc({ html, name: status.name, savedAt: Date.now() });
  };

  const handleFidelityChange = (html: string) => {
    saveFidelityDoc({ html, name: status.name, savedAt: Date.now() });
  };

  return (
    <>
      <EditorTopBar
        active="docs"
        center={<DocumentTitle name={status.name} onRename={handleRename} />}
        right={
          // Gated on `mounted`, not just `mode`: the server always renders
          // as "univer" (no `window` to read `docs-mode` from), so if a
          // persisted "fidelity" mode reached this JSX on the client's
          // first render — before hydration reconciles against the
          // server's markup — the extra Preview/Export PDF buttons here
          // would already differ from what the server sent, which is
          // exactly a hydration mismatch. The `!mounted` branch below
          // matches the server's own "univer" output byte-for-byte.
          mounted && mode === "fidelity" ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fidelityApiRef.current?.printPreview()}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted hover:bg-black/5"
                title="Print preview"
              >
                <Eye size={13} /> Preview
              </button>
              <button
                type="button"
                onClick={() => fidelityApiRef.current?.exportAsPdf()}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted hover:bg-black/5"
                title="Export as PDF"
              >
                <FileDown size={13} /> Export PDF
              </button>
              <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted" title="Saved in this browser">
                <Cloud size={13} /> Saved
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-word-muted" title="Saved in this browser">
              <Cloud size={13} /> Saved
            </span>
          )
        }
      />
      <div className="word-docs flex min-h-0 flex-1 flex-col overflow-hidden bg-word-canvas">
        {!mounted ? (
          <div className="flex flex-1 items-center justify-center text-sm text-word-muted">Loading editor…</div>
        ) : mode === "univer" ? (
          <DocsEditor apiRef={apiRef} onStatusChange={setStatus} onRichPasteDetected={handleRichPasteDetected} />
        ) : (
          <FidelityDocEditor
            initialHtml={fidelityHtml}
            apiRef={fidelityApiRef}
            onStatusChange={setStatus}
            onChange={handleFidelityChange}
          />
        )}
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
