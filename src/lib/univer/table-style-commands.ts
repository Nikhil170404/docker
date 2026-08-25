import type {
  DocumentDataModel,
  IAccessor,
  IColorStyle,
  ICommand,
  IMutationInfo,
  JSONXActions,
} from "@univerjs/core";
import type { IRichTextEditingMutationParams } from "@univerjs/docs";
import {
  BooleanNumber,
  CommandType,
  HorizontalAlign,
  ICommandService,
  IUniverInstanceService,
  JSONX,
  TableRowHeightRule,
  TableLayoutType,
  TableSizeType,
  TextX,
  TextXActionType,
  UniverInstanceType,
  VerticalAlignmentType,
} from "@univerjs/core";
import { DocSelectionManagerService, DocSkeletonManagerService, RichTextEditingMutation } from "@univerjs/docs";
import { IRenderManagerService } from "@univerjs/engine-render";
import { getCommandSkeleton } from "@univerjs/docs-ui";

// These commands fill a real gap in Univer's open-source Docs table plugin:
// the data model (ITableCell.backgroundColor/borderTop.../vAlign, ITableRow.trHeight,
// ITable.layout) already supports all of this and the renderer already paints it —
// there just aren't any built-in commands or toolbar buttons to set them yet.
// Every command below only ever writes plain properties via JSONX ops (no dataStream
// edits), which keeps them in the same low-risk category as Univer's own
// column-width-on-insert logic. Cell merge/split needs dataStream edits too
// (removing table cells changes the document's text stream) and is intentionally
// not included here — that's real-but-separate follow-up work.

export type SelectedTableRange = {
  tableId: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

// A caret merely positioned inside one cell (no drag-selected block) never
// produces a rectRange — confirmed in 1.0.0-beta.2, where a plain click
// into a cell yields getRectRanges() === []. Table identity for a plain
// caret only shows up in getDocRanges()'s startNodePosition.path, shaped
// like ["pages", 0, "skeTables", tableId, "rows", r, "cells", c, ...].
function extractTableCellFromPath(
  path: (string | number)[] | undefined,
): { tableId: string; row: number; column: number } | null {
  if (!path) return null;
  const tablesIdx = path.indexOf("skeTables");
  if (tablesIdx === -1) return null;
  const tableId = path[tablesIdx + 1];
  const rowsIdx = path.indexOf("rows", tablesIdx);
  const cellsIdx = path.indexOf("cells", tablesIdx);
  const row = rowsIdx === -1 ? undefined : path[rowsIdx + 1];
  const column = cellsIdx === -1 ? undefined : path[cellsIdx + 1];
  if (typeof tableId !== "string" || typeof row !== "number" || typeof column !== "number") return null;
  return { tableId, row, column };
}

// The single source of truth for "what table cell(s) is the user's live
// selection touching right now" — used both as the command-side fallback
// below and by DocsEditor's selection subscription that drives the Table
// Design ribbon's visibility.
export function resolveLiveTableRange(
  docSelectionManagerService: DocSelectionManagerService,
): SelectedTableRange | null {
  const rectRanges = docSelectionManagerService.getRectRanges();
  const rectRange = rectRanges?.find((r) => r.tableId);
  if (rectRange) {
    return remember({
      tableId: rectRange.tableId,
      startRow: Math.min(rectRange.startRow, rectRange.endRow),
      endRow: Math.max(rectRange.startRow, rectRange.endRow),
      startColumn: Math.min(rectRange.startColumn, rectRange.endColumn),
      endColumn: Math.max(rectRange.startColumn, rectRange.endColumn),
    });
  }

  const docRanges = docSelectionManagerService.getDocRanges();
  const cell = extractTableCellFromPath(docRanges?.[0]?.startNodePosition?.path);
  if (!cell) return null;

  return remember({
    tableId: cell.tableId,
    startRow: cell.row,
    endRow: cell.row,
    startColumn: cell.column,
    endColumn: cell.column,
  });
}

// Opening a ribbon dropdown (a colour picker, a row-height menu) moves DOM
// focus off the canvas, and Univer clears its live selection when that
// happens — so by the time the click that applies the command lands, the
// live lookup above can already return null. Remembering the last real
// table selection keeps those commands working; the Table Design tab is
// only on screen while a table selection exists in the first place.
let rememberedRange: SelectedTableRange | null = null;

function remember(range: SelectedTableRange): SelectedTableRange {
  rememberedRange = range;
  return range;
}

/** Called when an editor is torn down so no range leaks into the next one. */
export function clearRememberedTableRange() {
  rememberedRange = null;
}

// Focusing any input outside the canvas (typing a border width, a row
// height...) clears Univer's live selection before the button click that
// applies it ever fires. Every command below therefore accepts an explicit
// `range` in its params — captured by the panel from a selection-change
// subscription while the selection was still live — and only falls back to
// querying live selection when one isn't provided.
function resolveTableRange(accessor: IAccessor, explicit?: SelectedTableRange | null): SelectedTableRange | null {
  if (explicit) return explicit;
  const docSelectionManagerService = accessor.get(DocSelectionManagerService);
  return resolveLiveTableRange(docSelectionManagerService) ?? rememberedRange;
}

function getDocAndTable(accessor: IAccessor, tableId: string) {
  const univerInstanceService = accessor.get(IUniverInstanceService);
  const docDataModel = univerInstanceService.getCurrentUnitOfType<DocumentDataModel>(
    UniverInstanceType.UNIVER_DOC,
  );
  if (!docDataModel) return null;

  const table = docDataModel.getSnapshot().tableSource?.[tableId];
  if (!table) return null;

  return { docDataModel, table };
}

function setProperty(
  jsonX: ReturnType<typeof JSONX.getInstance>,
  rawActions: JSONXActions[],
  path: (string | number)[],
  oldVal: unknown,
  newVal: unknown,
) {
  if (oldVal === undefined && newVal === undefined) return;

  const op =
    oldVal === undefined
      ? jsonX.insertOp(path, newVal)
      : newVal === undefined
        ? jsonX.removeOp(path, oldVal)
        : jsonX.replaceOp(path, oldVal, newVal);

  if (op) rawActions.push(op as JSONXActions);
}

// The RETAIN edit above is enough to trigger a repaint (proven for border/
// background), but properties that affect box dimensions — row height, in
// particular — are cached in the skeleton at layout time and a repaint
// alone reads the stale cached height. Force a real layout recalculation.
function forceRelayout(accessor: IAccessor, unitId: string) {
  const renderManagerService = accessor.get(IRenderManagerService);
  const render = renderManagerService.getRenderUnitById(unitId);
  const skeletonManagerService = render?.with(DocSkeletonManagerService);
  const skeleton = skeletonManagerService?.getSkeleton();
  skeleton?.makeDirty(true);
  skeleton?.calculate();
  // Recalculating the skeleton alone updates cached layout data but doesn't
  // repaint — the canvas still shows the old frame until the scene is told
  // to redraw. This last line is what actually made row-height changes
  // (and any other layout-affecting property) visible on screen.
  render?.scene.makeDirty(true);
  render?.mainComponent?.makeDirty(true);
  void render?.scene.requestRender();
}

function runMutation(
  accessor: IAccessor,
  docDataModel: DocumentDataModel,
  rawActions: JSONXActions[],
): boolean {
  if (!rawActions.length) return false;

  const commandService = accessor.get(ICommandService);
  const docSelectionManagerService = accessor.get(DocSelectionManagerService);
  const activeTextRange = docSelectionManagerService.getActiveTextRange();

  // Property-only JSONX ops (no textX component) don't reliably trigger a
  // skeleton rebuild — Univer's own table commands always bundle a textX
  // edit alongside their JSONX ops for exactly this reason. A full-length
  // RETAIN is a no-op edit that forces the same re-layout/repaint pass.
  const body = docDataModel.getBody();
  const bodyLength = body?.dataStream.length ?? 0;
  const jsonX = JSONX.getInstance();
  const allActions = [...rawActions];

  if (bodyLength > 0) {
    const textX = new TextX();
    textX.push({ t: TextXActionType.RETAIN, len: bodyLength });
    // Equivalent to core's internal getRichTextEditPath(docDataModel, '') —
    // not part of core's public export surface, so inlined here.
    const editOp = jsonX.editOp(textX.serialize(), ["body"]);
    if (editOp) allActions.push(editOp as JSONXActions);
  }

  const actions = allActions.reduce(
    (acc, cur) => JSONX.compose(acc, cur),
    null as JSONXActions,
  );

  const doMutation: IMutationInfo<IRichTextEditingMutationParams> = {
    id: RichTextEditingMutation.id,
    params: {
      unitId: docDataModel.getUnitId(),
      actions,
      textRanges: activeTextRange ? [activeTextRange] : [],
    },
  };

  const result = commandService.syncExecuteCommand(doMutation.id, doMutation.params);
  if (result) forceRelayout(accessor, docDataModel.getUnitId());
  return Boolean(result);
}

// ---------------------------------------------------------------------------
// Cell background color
// ---------------------------------------------------------------------------

export interface ISetTableCellBackgroundParams {
  color: string | null;
  range?: SelectedTableRange | null;
}

export const SetTableCellBackgroundCommandId = "dockaro.command.table-cell-background";

export const SetTableCellBackgroundCommand: ICommand<ISetTableCellBackgroundParams> = {
  id: SetTableCellBackgroundCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
      const row = table.tableRows[r];
      if (!row) continue;
      for (let c = range.startColumn; c <= range.endColumn; c++) {
        const cell = row.tableCells[c];
        if (!cell) continue;
        const newVal: IColorStyle | undefined = params.color ? { rgb: params.color } : undefined;
        setProperty(
          jsonX,
          rawActions,
          ["tableSource", range.tableId, "tableRows", r, "tableCells", c, "backgroundColor"],
          cell.backgroundColor,
          newVal,
        );
      }
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Cell border (per side, color + width, or clear)
// ---------------------------------------------------------------------------

export type BorderSide = "Top" | "Bottom" | "Left" | "Right";

export interface ISetTableCellBorderParams {
  sides: BorderSide[];
  color: string | null;
  width: number;
  range?: SelectedTableRange | null;
}

export const SetTableCellBorderCommandId = "dockaro.command.table-cell-border";

export const SetTableCellBorderCommand: ICommand<ISetTableCellBorderParams> = {
  id: SetTableCellBorderCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params || params.sides.length === 0) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
      const row = table.tableRows[r];
      if (!row) continue;
      for (let c = range.startColumn; c <= range.endColumn; c++) {
        const cell = row.tableCells[c];
        if (!cell) continue;

        for (const side of params.sides) {
          const key = `border${side}` as const;
          const newVal = params.color
            ? { color: { rgb: params.color }, width: { v: params.width } }
            : undefined;

          setProperty(
            jsonX,
            rawActions,
            ["tableSource", range.tableId, "tableRows", r, "tableCells", c, key],
            (cell as Record<string, unknown>)[key],
            newVal,
          );
        }
      }
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Cell vertical alignment
// ---------------------------------------------------------------------------

export interface ISetTableCellVAlignParams {
  vAlign: VerticalAlignmentType;
  range?: SelectedTableRange | null;
}

export const SetTableCellVAlignCommandId = "dockaro.command.table-cell-valign";

export const SetTableCellVAlignCommand: ICommand<ISetTableCellVAlignParams> = {
  id: SetTableCellVAlignCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
      const row = table.tableRows[r];
      if (!row) continue;
      for (let c = range.startColumn; c <= range.endColumn; c++) {
        const cell = row.tableCells[c];
        if (!cell) continue;
        setProperty(
          jsonX,
          rawActions,
          ["tableSource", range.tableId, "tableRows", r, "tableCells", c, "vAlign"],
          cell.vAlign,
          params.vAlign,
        );
      }
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Row height
// ---------------------------------------------------------------------------

export interface ISetTableRowHeightParams {
  mode: "auto" | "fixed";
  height?: number;
  range?: SelectedTableRange | null;
}

export const SetTableRowHeightCommandId = "dockaro.command.table-row-height";

export const SetTableRowHeightCommand: ICommand<ISetTableRowHeightParams> = {
  id: SetTableRowHeightCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    const newTrHeight =
      params.mode === "auto"
        ? { val: { v: 30 }, hRule: TableRowHeightRule.AUTO }
        : { val: { v: params.height ?? 30 }, hRule: TableRowHeightRule.EXACT };

    for (let r = range.startRow; r <= range.endRow; r++) {
      const row = table.tableRows[r];
      if (!row) continue;
      setProperty(
        jsonX,
        rawActions,
        ["tableSource", range.tableId, "tableRows", r, "trHeight"],
        row.trHeight,
        newTrHeight,
      );
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Column width — Univer's Docs table has no interactive drag-to-resize
// (confirmed: no such command exists anywhere in docs-ui, only an internal
// auto-fit-to-page-width helper). This is the reliable substitute: type an
// exact width for the selected column(s) instead of dragging a border.
// ---------------------------------------------------------------------------

export interface ISetTableColumnWidthParams {
  width: number;
  range?: SelectedTableRange | null;
}

export const SetTableColumnWidthCommandId = "dockaro.command.table-column-width";

export const SetTableColumnWidthCommand: ICommand<ISetTableColumnWidthParams> = {
  id: SetTableColumnWidthCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params || params.width <= 0) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    for (let c = range.startColumn; c <= range.endColumn; c++) {
      const column = table.tableColumns[c];
      if (!column) continue;
      setProperty(
        jsonX,
        rawActions,
        ["tableSource", range.tableId, "tableColumns", c, "size", "width", "v"],
        column.size.width.v,
        params.width,
      );
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Drag-resizing a column border, the way Word does it
// ---------------------------------------------------------------------------
//
// Dragging a border in Word moves that border: the column on its left takes
// the delta and the column on its right gives it back, so the table keeps
// its overall width. Dragging the table's own right edge widens the table
// instead. Both are one command so a drag is a single undo step.

/** Word refuses to shrink a column below roughly this width. */
const MIN_COLUMN_WIDTH = 24;

export interface IResizeTableColumnParams {
  tableId: string;
  /** Index of the column on the left of the dragged border. */
  columnIndex: number;
  /** Movement in document pixels; positive widens the left column. */
  delta: number;
}

export const ResizeTableColumnCommandId = "dockaro.command.table-resize-column";

export const ResizeTableColumnCommand: ICommand<IResizeTableColumnParams> = {
  id: ResizeTableColumnCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params || !params.delta) return false;
    const found = getDocAndTable(accessor, params.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const left = table.tableColumns[params.columnIndex];
    if (!left) return false;
    const right = table.tableColumns[params.columnIndex + 1];
    const leftWidth = left.size?.width?.v ?? 0;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];
    const setColumnWidth = (index: number, from: number, to: number) => {
      setProperty(
        jsonX,
        rawActions,
        ["tableSource", params.tableId, "tableColumns", index, "size", "width", "v"],
        from,
        to,
      );
    };

    if (right) {
      const rightWidth = right.size?.width?.v ?? 0;
      // Clamp the drag so neither side collapses; the border simply stops.
      const delta = Math.max(
        MIN_COLUMN_WIDTH - leftWidth,
        Math.min(rightWidth - MIN_COLUMN_WIDTH, params.delta),
      );
      if (!delta) return false;
      setColumnWidth(params.columnIndex, leftWidth, leftWidth + delta);
      setColumnWidth(params.columnIndex + 1, rightWidth, rightWidth - delta);
    } else {
      const delta = Math.max(MIN_COLUMN_WIDTH - leftWidth, params.delta);
      if (!delta) return false;
      setColumnWidth(params.columnIndex, leftWidth, leftWidth + delta);
      const tableWidth = table.size?.width?.v;
      if (typeof tableWidth === "number") {
        setProperty(
          jsonX,
          rawActions,
          ["tableSource", params.tableId, "size", "width", "v"],
          tableWidth,
          tableWidth + delta,
        );
      }
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Drag-resizing a row border
// ---------------------------------------------------------------------------

/** Word's minimum row height, in document pixels. */
const MIN_ROW_HEIGHT = 16;

export interface IResizeTableRowParams {
  tableId: string;
  rowIndex: number;
  /** The row's new height in document pixels. */
  height: number;
}

export const ResizeTableRowCommandId = "dockaro.command.table-resize-row";

export const ResizeTableRowCommand: ICommand<IResizeTableRowParams> = {
  id: ResizeTableRowCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const found = getDocAndTable(accessor, params.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;
    const row = table.tableRows[params.rowIndex];
    if (!row) return false;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];
    setProperty(
      jsonX,
      rawActions,
      ["tableSource", params.tableId, "tableRows", params.rowIndex, "trHeight"],
      row.trHeight,
      // Dragging a row border in Word sets a minimum height, not a fixed
      // one: the row still grows if its content needs more space.
      { val: { v: Math.max(MIN_ROW_HEIGHT, params.height) }, hRule: TableRowHeightRule.AT_LEAST },
    );

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Table layout (auto-fit vs fixed column widths)
// ---------------------------------------------------------------------------

export interface ISetTableLayoutParams {
  layout: "auto" | "fixed";
  range?: SelectedTableRange | null;
}

export const SetTableLayoutCommandId = "dockaro.command.table-layout";

export const SetTableLayoutCommand: ICommand<ISetTableLayoutParams> = {
  id: SetTableLayoutCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    const newVal = params.layout === "auto" ? TableLayoutType.AUTO_FIT : TableLayoutType.FIXED;

    setProperty(
      jsonX,
      rawActions,
      ["tableSource", range.tableId, "layout"],
      table.layout,
      newVal,
    );

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Banded (striped) rows — whole table, two alternating colors
// ---------------------------------------------------------------------------

export interface ISetTableBandedRowsParams {
  enabled: boolean;
  colorOdd?: string;
  colorEven?: string;
  range?: SelectedTableRange | null;
}

export const SetTableBandedRowsCommandId = "dockaro.command.table-banded-rows";

export const SetTableBandedRowsCommand: ICommand<ISetTableBandedRowsParams> = {
  id: SetTableBandedRowsCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    table.tableRows.forEach((row, r) => {
      const isOdd = r % 2 === 0;
      const color = !params.enabled
        ? undefined
        : isOdd
          ? (params.colorOdd ?? "#F7F7F8")
          : (params.colorEven ?? "#FFFFFF");
      const newVal: IColorStyle | undefined = color ? { rgb: color } : undefined;

      row.tableCells.forEach((cell, c) => {
        setProperty(
          jsonX,
          rawActions,
          ["tableSource", range.tableId, "tableRows", r, "tableCells", c, "backgroundColor"],
          cell.backgroundColor,
          newVal,
        );
      });
    });

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Repeat header row
// ---------------------------------------------------------------------------

export interface ISetTableHeaderRowParams {
  enabled: boolean;
  range?: SelectedTableRange | null;
}

export const SetTableHeaderRowCommandId = "dockaro.command.table-header-row";

export const SetTableHeaderRowCommand: ICommand<ISetTableHeaderRowParams> = {
  id: SetTableHeaderRowCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const firstRow = table.tableRows[0];
    if (!firstRow) return false;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    setProperty(
      jsonX,
      rawActions,
      ["tableSource", range.tableId, "tableRows", 0, "repeatHeaderRow"],
      firstRow.repeatHeaderRow,
      params.enabled ? BooleanNumber.TRUE : undefined,
    );
    setProperty(
      jsonX,
      rawActions,
      ["tableSource", range.tableId, "tableRows", 0, "isFirstRow"],
      firstRow.isFirstRow,
      params.enabled ? BooleanNumber.TRUE : undefined,
    );

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Merge cells (horizontal, same row only)
// ---------------------------------------------------------------------------
//
// NOTE: this command is data-correct but deliberately not wired into
// TableRibbon's UI right now. Root-caused against Univer's own layout
// engine source (engine-render/src/components/docs/layout/block/table.ts):
// a merge is represented by leaving the absorbed cell IN PLACE with
// columnSpan set to 0 (isCoveredTableCell checks `columnSpan === 0`) while
// the anchor cell's columnSpan is set to the spanned count — confirmed
// correct, and confirmed to update the persisted snapshot correctly. BUT
// the only span-aware sizing function in that file, applyMergedCellSpanHeights,
// computes height for rowSpan and has no width-equivalent for columnSpan —
// so the anchor cell's box never actually widens on screen. The covered
// cell's content/background/border correctly stop painting
// (_drawTable/_drawTableCellBackgrounds in engine-render's document.ts both
// check isMergedCellCovered), it just leaves a visually blank gap instead
// of a wider cell. This is a genuine gap in this Univer version's table
// renderer, not fixable from application code — revisit if a newer Univer
// release adds column-span width handling. Kept here (unused) since the
// data model side is correct and this becomes a one-line UI change
// (re-add the Merge button in TableRibbon) once upstream catches up.
//
// An earlier version of this command instead deleted the absorbed cells'
// dataStream content and removed them from the tableCells array (mirroring
// Univer's DocTableDeleteColumnsCommand). That passed Univer's own
// structural-integrity checks but silently failed to render — array
// removal desyncs a row's cell count from its sibling rows and from
// tableColumns, which the layout engine doesn't expect. Property-only
// edits (this version) avoid that whole class of problem and match every
// other command in this file's low-risk category.
//
// Scoped to a single row deliberately — a real rowSpan merge needs the
// same columnSpan-style tombstoning applied per-row, which is realistic
// follow-up work, not included here. Splitting a merged cell back apart is
// the mirror image (columnSpan back to 1 on the tombstoned cells).

export interface IMergeTableCellsParams {
  range?: SelectedTableRange | null;
}

export const MergeTableCellsCommandId = "dockaro.command.table-merge-cells";

export const MergeTableCellsCommand: ICommand<IMergeTableCellsParams> = {
  id: MergeTableCellsCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    const range = resolveTableRange(accessor, params?.range);
    if (!range) return false;
    if (range.startRow !== range.endRow) return false;
    if (range.startColumn === range.endColumn) return false;

    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const row = table.tableRows[range.startRow];
    const anchorCell = row?.tableCells[range.startColumn];
    if (!row || !anchorCell) return false;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    setProperty(
      jsonX,
      rawActions,
      ["tableSource", range.tableId, "tableRows", range.startRow, "tableCells", range.startColumn, "columnSpan"],
      anchorCell.columnSpan,
      range.endColumn - range.startColumn + 1,
    );

    for (let c = range.startColumn + 1; c <= range.endColumn; c++) {
      const cell = row.tableCells[c];
      if (!cell) continue;
      setProperty(
        jsonX,
        rawActions,
        ["tableSource", range.tableId, "tableRows", range.startRow, "tableCells", c, "columnSpan"],
        cell.columnSpan,
        0,
      );
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Cell alignment (9-way grid: 3 horizontal x 3 vertical)
// ---------------------------------------------------------------------------
//
// Vertical alignment is a table-cell property (existing pattern above).
// Horizontal alignment of a cell's text is a PARAGRAPH property — Univer
// has no separate "cell horizontal align," Word doesn't either, it's just
// the paragraph(s) inside the cell. Finding those paragraphs needs the
// cell's startIndex/endIndex, which only exists in the layout viewModel
// (not in tableSource metadata) — same tree-walk verified working by the
// merge command above. Bundled into one atomic command instead of two
// separate ones (cell vAlign + native doc.command.align-*) because the
// native align commands run against Univer's LIVE selection, which the
// ribbon's own inputs routinely clear (see resolveTableRange's docs) —
// running both through our own resolved `range` avoids that entirely.
function findCellRange(
  accessor: IAccessor,
  docDataModel: DocumentDataModel,
  tableId: string,
  row: number,
  column: number,
): { startIndex: number; endIndex: number } | null {
  const docSkeletonManagerService = getCommandSkeleton(accessor, docDataModel.getUnitId());
  if (!docSkeletonManagerService) return null;
  const viewModel = docSkeletonManagerService.getViewModel();

  const body = docDataModel.getBody();
  const tableMeta = body?.tables?.find((t) => t.tableId === tableId);
  if (!body || !tableMeta) return null;

  type TableCellNode = { startIndex: number; endIndex: number };
  type TableRowNode = { children: TableCellNode[] };
  type TableNode = { startIndex: number; children: TableRowNode[] };

  let tableNode: TableNode | null = null;
  for (const section of viewModel.getChildren()) {
    for (const paragraph of section.children) {
      const node = paragraph.children[0];
      if (node && node.startIndex === tableMeta.startIndex) {
        tableNode = node as unknown as TableNode;
        break;
      }
    }
    if (tableNode) break;
  }
  if (!tableNode) return null;

  const cell = tableNode.children[row]?.children[column];
  return cell ? { startIndex: cell.startIndex, endIndex: cell.endIndex } : null;
}

export interface ISetTableCellAlignParams {
  horizontal: HorizontalAlign;
  vertical: VerticalAlignmentType;
  range?: SelectedTableRange | null;
}

export const SetTableCellAlignCommandId = "dockaro.command.table-cell-align";

export const SetTableCellAlignCommand: ICommand<ISetTableCellAlignParams> = {
  id: SetTableCellAlignCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    if (!params) return false;
    const range = resolveTableRange(accessor, params.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;
    const body = docDataModel.getBody();
    if (!body?.paragraphs) return false;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    for (let r = range.startRow; r <= range.endRow; r++) {
      const row = table.tableRows[r];
      if (!row) continue;
      for (let c = range.startColumn; c <= range.endColumn; c++) {
        const cell = row.tableCells[c];
        if (!cell) continue;

        setProperty(
          jsonX,
          rawActions,
          ["tableSource", range.tableId, "tableRows", r, "tableCells", c, "vAlign"],
          cell.vAlign,
          params.vertical,
        );

        const cellRange = findCellRange(accessor, docDataModel, range.tableId, r, c);
        if (!cellRange) continue;
        body.paragraphs.forEach((paragraph, pIndex) => {
          if (paragraph.startIndex < cellRange.startIndex || paragraph.startIndex > cellRange.endIndex) return;
          setProperty(
            jsonX,
            rawActions,
            ["body", "paragraphs", pIndex, "paragraphStyle", "horizontalAlign"],
            paragraph.paragraphStyle?.horizontalAlign,
            params.horizontal,
          );
        });
      }
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

// ---------------------------------------------------------------------------
// Fit table to window (stretch to the page's content width, evenly)
// ---------------------------------------------------------------------------

export interface ISetTableFitToWindowParams {
  range?: SelectedTableRange | null;
}

export const SetTableFitToWindowCommandId = "dockaro.command.table-fit-to-window";

export const SetTableFitToWindowCommand: ICommand<ISetTableFitToWindowParams> = {
  id: SetTableFitToWindowCommandId,
  type: CommandType.COMMAND,
  handler: (accessor, params) => {
    const range = resolveTableRange(accessor, params?.range);
    if (!range) return false;
    const found = getDocAndTable(accessor, range.tableId);
    if (!found) return false;
    const { docDataModel, table } = found;

    const docStyle = docDataModel.getSnapshot().documentStyle;
    const pageWidth = docStyle?.pageSize?.width ?? 794;
    const marginLeft = docStyle?.marginLeft ?? 72;
    const marginRight = docStyle?.marginRight ?? 72;
    const contentWidth = Math.max(100, pageWidth - marginLeft - marginRight);
    const columnCount = table.tableColumns.length || 1;
    const perColumnWidth = Math.floor(contentWidth / columnCount);

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    setProperty(jsonX, rawActions, ["tableSource", range.tableId, "layout"], table.layout, TableLayoutType.FIXED);
    setProperty(
      jsonX,
      rawActions,
      ["tableSource", range.tableId, "size"],
      table.size,
      { type: TableSizeType.SPECIFIED, width: { v: contentWidth } },
    );

    table.tableColumns.forEach((col, i) => {
      setProperty(
        jsonX,
        rawActions,
        ["tableSource", range.tableId, "tableColumns", i, "size"],
        col.size,
        { type: TableSizeType.SPECIFIED, width: { v: perColumnWidth } },
      );
    });

    return runMutation(accessor, docDataModel, rawActions);
  },
};

export const ALL_TABLE_STYLE_COMMANDS: ICommand[] = [
  ResizeTableColumnCommand,
  ResizeTableRowCommand,
  SetTableCellBackgroundCommand,
  SetTableCellBorderCommand,
  SetTableCellVAlignCommand,
  SetTableCellAlignCommand,
  SetTableRowHeightCommand,
  SetTableColumnWidthCommand,
  SetTableLayoutCommand,
  SetTableFitToWindowCommand,
  SetTableBandedRowsCommand,
  SetTableHeaderRowCommand,
  MergeTableCellsCommand,
];
