"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download, FilePlus2 } from "lucide-react";
import EditorTopBar from "@/components/editors/EditorTopBar";
import type { DocsEditorHandle, ExportFormat } from "@/components/editors/DocsEditor";

const DocsEditor = dynamic(() => import("@/components/editors/DocsEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-muted">
      Loading editor…
    </div>
  ),
});

const LINE_SPACINGS: { label: string; value: number }[] = [
  { label: "1.0", value: 1 },
  { label: "1.15", value: 1.15 },
  { label: "1.5", value: 1.5 },
  { label: "2.0", value: 2 },
];

const EXPORT_FORMATS: { label: string; value: ExportFormat }[] = [
  { label: "Word (.doc)", value: "word" },
  { label: "PDF", value: "pdf" },
  { label: "Web page (.html)", value: "html" },
];

export default function DocsEditorPage() {
  const apiRef = useRef<DocsEditorHandle | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <>
      <EditorTopBar
        active="docs"
        right={
          <>
            <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5">
              {LINE_SPACINGS.map((s) => (
                <button
                  key={s.value}
                  title={`${s.label} line spacing`}
                  onClick={() => apiRef.current?.setLineSpacing(s.value)}
                  className="shrink-0 rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => apiRef.current?.openHeaderFooter()}
              className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
            >
              Header &amp; footer
            </button>
            <button
              onClick={() => apiRef.current?.insertPageBreak()}
              title="Insert a page break at the cursor"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
            >
              <FilePlus2 size={13} /> New page
            </button>
            <div className="relative shrink-0">
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90"
              >
                <Download size={13} /> Export
              </button>
              {exportOpen && (
                <>
                  {/* Click-outside catcher — sits behind the menu, above everything else. */}
                  <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-surface py-1 shadow-lg">
                    {EXPORT_FORMATS.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => {
                          apiRef.current?.exportDocument(f.value);
                          setExportOpen(false);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-xs text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        }
      />
      <div className="flex-1 overflow-hidden">
        <DocsEditor apiRef={apiRef} />
      </div>
    </>
  );
}
