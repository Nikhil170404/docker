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
import { ICommandService, JSONX, TextX, TextXActionType } from "@univerjs/core";
import type { IDocumentData, IMutationInfo, Injector, JSONXActions } from "@univerjs/core";
import { DocSelectionManagerService, RichTextEditingMutation } from "@univerjs/docs";
import type { IRichTextEditingMutationParams } from "@univerjs/docs";
import { IRenderManagerService } from "@univerjs/engine-render";
import { DocSkeletonManagerService } from "@univerjs/docs";
import { ALL_TABLE_STYLE_COMMANDS, type SelectedTableRange } from "@/lib/univer/table-style-commands";
import { loadSnapshot, saveSnapshot } from "@/lib/univer/persistence";
import TableRibbon from "./TableRibbon";

const STORAGE_KEY = "docs-default";
const AUTOSAVE_DELAY_MS = 600;

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
    });

    // NOTE: any custom `documentStyle` passed into createUniverDoc() crashes
    // this Univer version with 5 identical uncaught errors
    // (getDataModel/dirty$/onScrollAfter$/transformer not init) — confirmed
    // with two unrelated overrides (documentFlavor: TRADITIONAL to unlock
    // header/footer editing, and an explicit A4 pageSize to force real
    // pagination instead of one endlessly-growing page). Same crash
    // signature both times, so it's not either feature specifically — it's
    // documentStyle initialization itself that's broken in this
    // version/preset combination. Left at the bare default deliberately.
    // Revisit if a newer Univer version fixes this upstream.
    const saved = loadSnapshot<Partial<IDocumentData>>(STORAGE_KEY);
    const fDoc = univerAPI.createDocument(saved ?? {});

    const injector = univer.__getInjector() as Injector;
    const commandService = injector.get(ICommandService);
    ALL_TABLE_STYLE_COMMANDS.forEach((cmd) => commandService.registerCommand(cmd));
    commandServiceRef.current = commandService;

    // Passing pageSize at createUniverDoc() time crashes this Univer
    // version (see note above). Patching it as a property mutation AFTER
    // creation avoids the crash (same safe JSONX pattern as every
    // table-style command) — but it does NOT make the editor paginate.
    // Tested with 60 lines of content: still one continuously-growing
    // page, no page-break gap anywhere, with or without this patch.
    // Pagination genuinely isn't reachable in this Univer version/preset
    // combination via either creation-time or post-creation config —
    // confirmed, not assumed. Kept anyway because a correct pageSize.width
    // still feeds other subsystems correctly (e.g. table auto-fit column
    // width, which falls back to a hardcoded 800 when pageSize is unset).
    const snapshot = fDoc.save();
    if (!snapshot.documentStyle?.pageSize) {
      const jsonX = JSONX.getInstance();
      const rawActions: JSONXActions[] = [];
      const newPageSize = { width: 794, height: 1123 };
      const op = jsonX.insertOp(["documentStyle", "pageSize"], newPageSize);
      if (op) rawActions.push(op as JSONXActions);

      const bodyLength = snapshot.body?.dataStream.length ?? 0;
      if (bodyLength > 0) {
        const textX = new TextX();
        textX.push({ t: TextXActionType.RETAIN, len: bodyLength });
        const editOp = jsonX.editOp(textX.serialize(), ["body"]);
        if (editOp) rawActions.push(editOp as JSONXActions);
      }

      const actions = rawActions.reduce((acc, cur) => JSONX.compose(acc, cur), null as JSONXActions);
      const doMutation: IMutationInfo<IRichTextEditingMutationParams> = {
        id: RichTextEditingMutation.id,
        params: { unitId: fDoc.getId(), actions, textRanges: [] },
      };
      commandService.syncExecuteCommand(doMutation.id, doMutation.params);

      const renderManagerService = injector.get(IRenderManagerService);
      const render = renderManagerService.getRenderUnitById(fDoc.getId());
      const skeleton = render?.with(DocSkeletonManagerService)?.getSkeleton();
      skeleton?.makeDirty(true);
      skeleton?.calculate();
      render?.scene.makeDirty(true);
      render?.mainComponent?.makeDirty(true);
      void render?.scene.requestRender();
    }

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
      const rectRanges = docSelectionManagerService.getRectRanges();
      const range = rectRanges?.find((r) => r.tableId);

      // Reflect the CURRENT selection exactly, like Word's Table Tools tab —
      // show only while the selection is actually a table range, hide the
      // instant it isn't. (Previously this only ever turned on and never
      // back off, so one table click left the ribbon stuck on forever,
      // including through an unrelated Select All.)
      setTableActive(Boolean(range));

      if (range) {
        lastTableRangeRef.current = {
          tableId: range.tableId,
          startRow: Math.min(range.startRow, range.endRow),
          endRow: Math.max(range.startRow, range.endRow),
          startColumn: Math.min(range.startColumn, range.endColumn),
          endColumn: Math.max(range.startColumn, range.endColumn),
        };
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
