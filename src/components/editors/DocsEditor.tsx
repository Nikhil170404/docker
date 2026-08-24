"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import { UniverDocsDrawingPreset } from "@univerjs/preset-docs-drawing";
import UniverPresetDocsDrawingEnUS from "@univerjs/preset-docs-drawing/locales/en-US";
import { UniverDocsHyperLinkPreset } from "@univerjs/preset-docs-hyper-link";
import UniverPresetDocsHyperLinkEnUS from "@univerjs/preset-docs-hyper-link/locales/en-US";
import { UniverDocsThreadCommentPreset } from "@univerjs/preset-docs-thread-comment";
import UniverPresetDocsThreadCommentEnUS from "@univerjs/preset-docs-thread-comment/locales/en-US";
import { UniverDocsFindReplacePlugin } from "@univerjs/docs-find-replace";
import { DocumentFlavor, ICommandService, validateDocumentStructure } from "@univerjs/core";
import type { IDocumentData, Injector } from "@univerjs/core";
import { DocSelectionManagerService } from "@univerjs/docs";
import { ALL_TABLE_STYLE_COMMANDS, resolveLiveTableRange, type SelectedTableRange } from "@/lib/univer/table-style-commands";
import { loadSnapshot, saveSnapshot, clearSnapshot } from "@/lib/univer/persistence";
import TableRibbon from "./TableRibbon";

const STORAGE_KEY = "docs-default";
const AUTOSAVE_DELAY_MS = 600;
// A4 at 96 DPI. Traditional flavor is what unlocks Word-compatible real
// pagination (page breaks, ruler-visible page bounds) and header/footer
// editing — both crash on creation-time documentStyle in Univer 0.25.x but
// work cleanly as of 1.0.0-beta.2.
const DEFAULT_DOCUMENT_STYLE = {
  pageSize: { width: 794, height: 1123 },
  documentFlavor: DocumentFlavor.TRADITIONAL,
};

import "@univerjs/preset-docs-core/lib/index.css";
import "@univerjs/preset-docs-drawing/lib/index.css";
import "@univerjs/preset-docs-hyper-link/lib/index.css";
import "@univerjs/preset-docs-thread-comment/lib/index.css";

export type DocsEditorHandle = {
  openHeaderFooter: () => void;
  setLineSpacing: (lineSpacing: number) => void;
};

export default function DocsEditor({ apiRef }: { apiRef?: React.RefObject<DocsEditorHandle | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const disposedRef = useRef(false);
  const commandServiceRef = useRef<ICommandService | null>(null);
  // Typing into the ribbon (a border width, a row height) steals focus from
  // the canvas, which clears Univer's live rect-range selection before the
  // "Apply" click can read it. This tracks the last real table-cell
  // selection independently so it survives that focus loss.
  const lastTableRangeRef = useRef<SelectedTableRange | null>(null);
  const [ready, setReady] = useState(false);
  const [tableActive, setTableActive] = useState(false);

  useEffect(() => {
    if (!containerRef.current || disposedRef.current) return;
    disposedRef.current = true;

    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(
          UniverPresetDocsCoreEnUS,
          UniverPresetDocsDrawingEnUS,
          UniverPresetDocsHyperLinkEnUS,
          UniverPresetDocsThreadCommentEnUS,
        ),
      },
      presets: [
        UniverDocsCorePreset({ container: containerRef.current }),
        UniverDocsDrawingPreset(),
        UniverDocsHyperLinkPreset(),
        UniverDocsThreadCommentPreset(),
      ],
      plugins: [UniverDocsFindReplacePlugin],
    });

    // Docs saved before the 1.0.0-beta.2 upgrade won't have a documentStyle
    // (it used to crash at creation time in 0.25.x — see git history), so
    // they'd silently lose pagination/header-footer on load. Backfill it
    // for any saved doc that predates this, without touching its content.
    let saved = loadSnapshot<Partial<IDocumentData>>(STORAGE_KEY);

    // 1.0.0-beta.2 added a strict structural-integrity check that now runs
    // on every edit (table start/end tokens, section IDs, etc.) and throws
    // if violated — Univer 0.25.x never validated this, so a doc edited
    // under the old version (in particular through our own dataStream-
    // editing MergeTableCellsCommand) can carry corruption that only
    // surfaces now, crashing on the very first edit after load. Check
    // before handing anything to createDocument(): a corrupt snapshot is
    // backed up under its own key (nothing is silently destroyed) and the
    // editor falls back to a fresh document instead of hard-crashing.
    if (saved?.body) {
      const issues = validateDocumentStructure(saved as Pick<IDocumentData, "body" | "headers" | "footers">);
      if (issues.length > 0) {
        console.warn("[DocKaro] Saved document failed structure validation, starting fresh:", issues);
        saveSnapshot(`${STORAGE_KEY}.corrupted.${Date.now()}`, saved);
        clearSnapshot(STORAGE_KEY);
        saved = null;
      }
    }

    const initialData: Partial<IDocumentData> = saved
      ? { ...saved, documentStyle: { ...DEFAULT_DOCUMENT_STYLE, ...saved.documentStyle } }
      : { documentStyle: DEFAULT_DOCUMENT_STYLE };
    const fDoc = univerAPI.createDocument(initialData);

    const injector = univer.__getInjector() as Injector;
    const commandService = injector.get(ICommandService);
    ALL_TABLE_STYLE_COMMANDS.forEach((cmd) => commandService.registerCommand(cmd));
    commandServiceRef.current = commandService;

    // Autosave: debounce so a fast typist doesn't hit localStorage on every
    // keystroke, and flush immediately on refresh/close so the last edit
    // isn't lost (React's unmount cleanup never runs on a hard refresh).
    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    const flushSave = () => saveSnapshot(STORAGE_KEY, fDoc.save());
    const commandSubscription = commandService.onCommandExecuted(() => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(flushSave, AUTOSAVE_DELAY_MS);
    });
    window.addEventListener("beforeunload", flushSave);

    const docSelectionManagerService = injector.get(DocSelectionManagerService);
    const subscription = docSelectionManagerService.textSelection$.subscribe(() => {
      const range = resolveLiveTableRange(docSelectionManagerService);

      // Reflect the CURRENT selection exactly, like Word's Table Tools tab —
      // show only while the selection is actually a table range, hide the
      // instant it isn't. (Previously this only ever turned on and never
      // back off, so one table click left the ribbon stuck on forever,
      // including through an unrelated Select All.)
      setTableActive(Boolean(range));

      if (range) {
        lastTableRangeRef.current = range;
      }
    });

    setReady(true);

    return () => {
      subscription.unsubscribe();
      commandSubscription.dispose();
      window.removeEventListener("beforeunload", flushSave);
      clearTimeout(saveTimeout);
      flushSave();

      // univer.dispose() torn down while Univer's async preset init hasn't
      // yet reached its "steady" lifecycle stage (unmounting/navigating away
      // very quickly after mount) leaves an internal
      // firstValueFrom(lifecycle$...) with nothing left to emit once
      // disposal completes the source stream — RxJS rejects that with
      // EmptyError ("no elements in sequence"), surfaced by V8's async
      // stack traces as if thrown right here. Harmless: the instance is
      // being torn down either way. Swallow only this specific error so a
      // fast unmount doesn't crash the dev overlay / bubble as an uncaught
      // rejection, while any other dispose failure still surfaces.
      const swallowEmptyError = (event: PromiseRejectionEvent) => {
        if (event.reason?.name === "EmptyError") event.preventDefault();
      };
      window.addEventListener("unhandledrejection", swallowEmptyError);
      try {
        univer.dispose();
      } catch (err) {
        if ((err as Error)?.name !== "EmptyError") throw err;
      } finally {
        setTimeout(() => window.removeEventListener("unhandledrejection", swallowEmptyError), 0);
      }

      disposedRef.current = false;
      commandServiceRef.current = null;
      lastTableRangeRef.current = null;
      setReady(false);
      setTableActive(false);
    };
  }, []);

  const runCommand = (id: string, params?: Record<string, unknown>) => {
    commandServiceRef.current?.executeCommand(id, {
      ...params,
      range: lastTableRangeRef.current,
    });
  };

  useImperativeHandle(apiRef, () => ({
    openHeaderFooter: () => runCommand("doc.command.open-header-footer-panel"),
    setLineSpacing: (lineSpacing: number) =>
      // spacingRule: 0 = SpacingRule.AUTO. Without it, the renderer treats
      // lineSpacing as an absolute size (clamped to the normal line height,
      // so it's invisible) instead of a multiplier — found by reading the
      // renderer's __getLineHeight source, not documented anywhere.
      runCommand("doc-paragraph-setting.command", { paragraph: { lineSpacing, spacingRule: 0 } }),
  }));

  return (
    <div className="flex h-full w-full flex-col">
      {ready && <TableRibbon run={runCommand} active={tableActive} />}
      <div ref={containerRef} className="h-full min-h-0 w-full flex-1" />
    </div>
  );
}
