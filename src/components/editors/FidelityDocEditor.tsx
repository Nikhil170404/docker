"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { WordDocumentStatus } from "./DocsEditor";
import PagedPreviewModal from "./PagedPreviewModal";
import { exportFidelityAsPdf } from "@/lib/fidelity/pagedPrint";
import { FIDELITY_PAGE_MARGIN_IN, FIDELITY_PAGE_WIDTH_IN, FIDELITY_PAGE_HEIGHT_IN } from "@/lib/fidelity/buildPrintableHtml";

// Same debounce this app already uses for the Univer editor's own
// autosave (DocsEditor.tsx), reused here rather than inventing a second
// value for the same kind of "don't write on every keystroke" concern.
const AUTOSAVE_DELAY_MS = 600;
const PX_PER_INCH = 96;

export type FidelityDocEditorHandle = {
  setName: (name: string) => void;
  setZoom: (zoom: number) => void;
  /** Current DOM content, serialized — used for persistence and export. */
  getHtml: () => string;
  printPreview: () => void;
  exportAsPdf: () => void;
};

/**
 * The fidelity-mode document surface: a single, uncontrolled
 * `contentEditable` element holding real pasted HTML/DOM directly — no
 * intermediate document model to lossy-convert through. Deliberately not
 * paginated while editing (see PagedPreviewModal's doc comment for why);
 * pagination only happens on demand for preview/PDF, both driven by the
 * shared `renderPagedContent` function so they can't drift apart.
 */
export default function FidelityDocEditor({
  initialHtml,
  apiRef,
  onStatusChange,
  onChange,
}: {
  initialHtml: string;
  apiRef?: React.RefObject<FidelityDocEditorHandle | null>;
  onStatusChange?: (status: WordDocumentStatus) => void;
  onChange?: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Captured once — this component owns the DOM from here on; a changed
  // `initialHtml` prop on a later render must NOT reset the user's typing,
  // so it's deliberately never read again after mount.
  const initialHtmlRef = useRef(initialHtml);
  const nameRef = useRef("Untitled document");
  const zoomRef = useRef(100);
  const statusListenerRef = useRef(onStatusChange);
  const onChangeRef = useRef(onChange);
  const [preview, setPreview] = useState<{ html: string; title: string } | null>(null);

  useEffect(() => {
    statusListenerRef.current = onStatusChange;
  }, [onStatusChange]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const pageHeightPx = (FIDELITY_PAGE_HEIGHT_IN - FIDELITY_PAGE_MARGIN_IN * 2) * PX_PER_INCH;

  const refreshStatus = useCallback(() => {
    const el = editorRef.current;
    const listener = statusListenerRef.current;
    if (!el || !listener) return;
    const words = (el.innerText.match(/\S+/g) ?? []).length;
    // scrollHeight-based — an estimate, not the precise Paged.js-computed
    // count. True pagination only happens for the on-demand preview/PDF.
    const pageCount = Math.max(1, Math.ceil(el.scrollHeight / pageHeightPx));
    listener({
      name: nameRef.current,
      wordCount: words,
      pageCount,
      currentPage: 1,
      zoom: zoomRef.current,
    });
  }, [pageHeightPx]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialHtmlRef.current;
    refreshStatus();

    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    const onInput = () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        onChangeRef.current?.(el.innerHTML);
        refreshStatus();
      }, AUTOSAVE_DELAY_MS);
    };
    el.addEventListener("input", onInput);
    return () => {
      clearTimeout(saveTimeout);
      el.removeEventListener("input", onInput);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(apiRef, () => ({
    setName: (name) => {
      nameRef.current = name;
      refreshStatus();
    },
    setZoom: (zoom) => {
      zoomRef.current = zoom;
      refreshStatus();
    },
    getHtml: () => editorRef.current?.innerHTML ?? "",
    // Ref reads belong in handlers, not render — captured once here into
    // state rather than read directly in the JSX below.
    printPreview: () => setPreview({ html: editorRef.current?.innerHTML ?? "", title: nameRef.current }),
    exportAsPdf: () => {
      void exportFidelityAsPdf(editorRef.current?.innerHTML ?? "", nameRef.current);
    },
  }));

  return (
    <div className="h-full min-h-0 w-full flex-1 overflow-auto bg-[#f3f3f3] py-8">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="fidelity-doc-page mx-auto bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)] outline-none"
        style={{
          width: `${FIDELITY_PAGE_WIDTH_IN * PX_PER_INCH}px`,
          minHeight: `${FIDELITY_PAGE_HEIGHT_IN * PX_PER_INCH}px`,
          padding: `${FIDELITY_PAGE_MARGIN_IN * PX_PER_INCH}px`,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "11pt",
          lineHeight: 1.4,
          color: "#1b1c1f",
        }}
      />
      {preview && (
        <PagedPreviewModal html={preview.html} title={preview.title} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
