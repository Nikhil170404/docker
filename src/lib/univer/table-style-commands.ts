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
  ICommandService,
  IUniverInstanceService,
  JSONX,
  TableRowHeightRule,
  TableLayoutType,
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

// Focusing any input outside the canvas (typing a border width, a row
// height...) clears Univer's live rect-range selection before the button
// click that applies it ever fires. Every command below therefore accepts
// an explicit `range` in its params — captured by the panel from a
// selection-change subscription while the selection was still live — and
// only falls back to querying live selection when one isn't provided.
function resolveTableRange(accessor: IAccessor, explicit?: SelectedTableRange | null): SelectedTableRange | null {
  if (explicit) return explicit;

  const docSelectionManagerService = accessor.get(DocSelectionManagerService);
  const rectRanges = docSelectionManagerService.getRectRanges();
  const range = rectRanges?.find((r) => r.tableId);
  if (!range) return null;

  return {
    tableId: range.tableId,
    startRow: Math.min(range.startRow, range.endRow),
    endRow: Math.max(range.startRow, range.endRow),
    startColumn: Math.min(range.startColumn, range.endColumn),
    endColumn: Math.max(range.startColumn, range.endColumn),
  };
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
// Unlike every command above, this touches the document's text stream, not
// just a property — merging cells means removing the absorbed cells'
// content from the dataStream, not just marking them merged. Adapted
// directly from Univer's own DocTableDeleteColumnsCommand (fetched from
// their GitHub source): same tree-walk to find each cell's exact
// startIndex/endIndex, same textX RETAIN+DELETE pattern, same right-to-left
// removeOp order to keep earlier indices stable during removal. The one
// difference from delete-columns: this only touches ONE row (the selected
// row), and instead of also removing the column definitions, it sets
// columnSpan on the surviving (leftmost) cell.
//
// Scoped to a single row deliberately — merging across multiple rows needs
// the same per-row offset bookkeeping delete-columns does when it spans all
// rows, which is meaningfully more moving parts to get right. Splitting a
// merged cell back apart is the mirror image (TextX INSERT + jsonX
// insertOp) and is realistic future follow-up work, not included here.

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

    const univerInstanceService = accessor.get(IUniverInstanceService);
    const docDataModel = univerInstanceService.getCurrentUnitOfType<DocumentDataModel>(
      UniverInstanceType.UNIVER_DOC,
    );
    if (!docDataModel) return false;

    const docSkeletonManagerService = getCommandSkeleton(accessor, docDataModel.getUnitId());
    if (!docSkeletonManagerService) return false;
    const viewModel = docSkeletonManagerService.getViewModel();

    const body = docDataModel.getBody();
    const tableMeta = body?.tables?.find((t) => t.tableId === range.tableId);
    if (!body || !tableMeta) return false;

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
    if (!tableNode) return false;

    const row = tableNode.children[range.startRow];
    const firstCellToRemove = row?.children[range.startColumn + 1];
    const lastCellToRemove = row?.children[range.endColumn];
    if (!firstCellToRemove || !lastCellToRemove) return false;

    const jsonX = JSONX.getInstance();
    const rawActions: JSONXActions[] = [];

    const textX = new TextX();
    const retainLen = firstCellToRemove.startIndex;
    const deleteLen = lastCellToRemove.endIndex - firstCellToRemove.startIndex + 1;
    if (retainLen > 0) textX.push({ t: TextXActionType.RETAIN, len: retainLen });
    textX.push({ t: TextXActionType.DELETE, len: deleteLen });
    const editOp = jsonX.editOp(textX.serialize(), ["body"]);
    if (editOp) rawActions.push(editOp as JSONXActions);

    for (let c = range.endColumn; c > range.startColumn; c--) {
      const op = jsonX.removeOp(["tableSource", range.tableId, "tableRows", range.startRow, "tableCells", c]);
      if (op) rawActions.push(op as JSONXActions);
    }

    const table = docDataModel.getSnapshot().tableSource?.[range.tableId];
    const anchorCell = table?.tableRows[range.startRow]?.tableCells[range.startColumn];
    if (anchorCell) {
      setProperty(
        jsonX,
        rawActions,
        ["tableSource", range.tableId, "tableRows", range.startRow, "tableCells", range.startColumn, "columnSpan"],
        anchorCell.columnSpan,
        range.endColumn - range.startColumn + 1,
      );
    }

    return runMutation(accessor, docDataModel, rawActions);
  },
};

export const ALL_TABLE_STYLE_COMMANDS: ICommand[] = [
  SetTableCellBackgroundCommand,
  SetTableCellBorderCommand,
  SetTableCellVAlignCommand,
  SetTableRowHeightCommand,
  SetTableColumnWidthCommand,
  SetTableLayoutCommand,
  SetTableBandedRowsCommand,
  SetTableHeaderRowCommand,
  MergeTableCellsCommand,
];
