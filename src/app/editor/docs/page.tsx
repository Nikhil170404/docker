"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import EditorTopBar from "@/components/editors/EditorTopBar";
import type { DocsEditorHandle } from "@/components/editors/DocsEditor";

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

export default function DocsEditorPage() {
  const apiRef = useRef<DocsEditorHandle | null>(null);

  return (
    <>
      <EditorTopBar
        active="docs"
        right={
          <>
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              {LINE_SPACINGS.map((s) => (
                <button
                  key={s.value}
                  title={`${s.label} line spacing`}
                  onClick={() => apiRef.current?.setLineSpacing(s.value)}
                  className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => apiRef.current?.openHeaderFooter()}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
            >
              Header &amp; footer
            </button>
          </>
        }
      />
      <div className="flex-1 overflow-hidden">
        <DocsEditor apiRef={apiRef} />
      </div>
    </>
  );
}
