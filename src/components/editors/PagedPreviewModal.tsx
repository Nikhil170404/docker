"use client";

import { useEffect, useRef, useState } from "react";
import { renderPagedContent, releasePagedContent } from "@/lib/fidelity/pagedPrint";

/**
 * On-demand paginated preview for a fidelity-mode document. Renders the
 * given HTML through the same `renderPagedContent` function PDF export
 * uses, so what's shown here is exactly what "Export PDF" will produce —
 * not a separate, hand-tuned approximation of it.
 *
 * Deliberately re-renders once per open rather than staying mounted and
 * live-updating: Paged.js has no incremental re-layout mode, so keeping
 * this open while the underlying document is being edited would mean
 * either constant full DOM teardown/rebuild (visually jarring, throws away
 * scroll position) or a stale snapshot either way. A fresh render per open
 * keeps it simple and correct at the moment it's asked for.
 */
export default function PagedPreviewModal({
  html,
  title,
  onClose,
}: {
  html: string;
  title: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"rendering" | "ready" | "error">("rendering");

  useEffect(() => {
    let cancelled = false;
    let rendered: HTMLElement | null = null;

    void renderPagedContent(html, title)
      .then((container) => {
        if (cancelled) {
          releasePagedContent(container);
          return;
        }
        rendered = container;
        container.style.position = "static";
        container.style.left = "auto";
        hostRef.current?.appendChild(container);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      if (rendered) releasePagedContent(rendered);
    };
  }, [html, title]);

  return (
    <div
      // Opaque, not translucent: this sits directly over the live
      // contentEditable fidelity-mode surface, and a semi-transparent
      // backdrop lets that still-mounted editor content show through,
      // dimmed — which visually reads as duplicated text stacked behind
      // the actual (single-copy) paginated render underneath it.
      className="fixed inset-0 z-[9999] flex flex-col bg-slate-700"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex shrink-0 items-center justify-between bg-white px-5 py-3 shadow">
        <div className="text-sm font-semibold text-slate-800">Print Preview — {title}</div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-auto py-8">
        {status === "rendering" && (
          <div className="mx-auto w-fit rounded-md bg-white px-4 py-3 text-sm text-slate-600 shadow">
            Rendering pages…
          </div>
        )}
        {status === "error" && (
          <div className="mx-auto w-fit rounded-md bg-white px-4 py-3 text-sm text-red-600 shadow">
            Couldn&apos;t render the preview.
          </div>
        )}
        <div ref={hostRef} className="fidelity-paged-preview mx-auto w-fit" />
      </div>
    </div>
  );
}
