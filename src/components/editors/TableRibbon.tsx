"use client";

import { useState } from "react";
import { VerticalAlignmentType } from "@univerjs/core";
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Columns3,
  Combine,
  PaintBucket,
  Rows3,
  Square,
  SquareStack,
} from "lucide-react";
import {
  MergeTableCellsCommandId,
  SetTableBandedRowsCommandId,
  SetTableCellBackgroundCommandId,
  SetTableCellBorderCommandId,
  SetTableCellVAlignCommandId,
  SetTableColumnWidthCommandId,
  SetTableHeaderRowCommandId,
  SetTableLayoutCommandId,
  SetTableRowHeightCommandId,
  type BorderSide,
} from "@/lib/univer/table-style-commands";

type RunCommand = (id: string, params?: Record<string, unknown>) => void;

const SWATCHES = ["#FEE2E2", "#FEF3C7", "#DCFCE7", "#DBEAFE", "#EDE9FE", "#FCE7F3", "#F3F4F6", "#111827"];
const BORDER_SIDES: BorderSide[] = ["Top", "Bottom", "Left", "Right"];

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 text-[10px] uppercase tracking-wide text-muted">{children}</span>;
}

function Divider() {
  return <div className="mx-1 h-8 w-px shrink-0 bg-border" />;
}

export default function TableRibbon({ run, active }: { run: RunCommand; active: boolean }) {
  const [borderColor, setBorderColor] = useState("#111827");
  const [borderWidth, setBorderWidth] = useState(1);
  const [borderSides, setBorderSides] = useState<Set<BorderSide>>(new Set(BORDER_SIDES));
  const [rowHeight, setRowHeight] = useState(40);
  const [colWidth, setColWidth] = useState(120);
  const [bandColor1, setBandColor1] = useState("#F7F7F8");
  const [bandColor2, setBandColor2] = useState("#FFFFFF");

  const toggleSide = (side: BorderSide) => {
    setBorderSides((prev) => {
      const next = new Set(prev);
      if (next.has(side)) next.delete(side);
      else next.add(side);
      return next;
    });
  };

  if (!active) {
    return (
      <div className="flex h-9 shrink-0 items-center justify-center border-b border-border bg-surface/60 text-xs text-muted">
        Click into a table to show Table Design tools
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col border-b border-border bg-surface">
      <div className="flex h-6 items-center border-b border-border/60 px-3">
        <span className="text-[11px] font-medium text-accent">Table Design</span>
      </div>
      <div className="relative">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
        {/* Shading */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <PaintBucket size={13} className="text-muted" />
            {SWATCHES.map((c) => (
              <button
                key={c}
                title={c}
                className="h-5 w-5 shrink-0 rounded border border-border"
                style={{ backgroundColor: c }}
                onClick={() => run(SetTableCellBackgroundCommandId, { color: c })}
              />
            ))}
            <button
              className="h-5 w-5 shrink-0 rounded border border-border bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,#ef444480_2px,#ef444480_3px)]"
              title="Clear shading"
              onClick={() => run(SetTableCellBackgroundCommandId, { color: null })}
            />
          </div>
          <GroupLabel>Shading</GroupLabel>
        </div>

        <Divider />

        {/* Borders */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1.5">
            {BORDER_SIDES.map((s) => (
              <button
                key={s}
                onClick={() => toggleSide(s)}
                title={`${s} border`}
                className={`flex h-6 w-6 items-center justify-center rounded border text-[10px] ${
                  borderSides.has(s)
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {s[0]}
              </button>
            ))}
            <input
              type="color"
              value={borderColor}
              onChange={(e) => setBorderColor(e.target.value)}
              className="h-6 w-6 shrink-0 rounded border border-border bg-transparent"
              title="Border color"
            />
            <input
              type="number"
              min={1}
              max={10}
              value={borderWidth}
              onChange={(e) => setBorderWidth(Number(e.target.value))}
              className="h-6 w-11 rounded border border-border bg-background px-1 text-center"
              title="Border width (px)"
            />
            <button
              className="h-6 rounded bg-white px-2 text-[11px] font-medium text-black"
              onClick={() =>
                run(SetTableCellBorderCommandId, {
                  sides: Array.from(borderSides),
                  color: borderColor,
                  width: borderWidth,
                })
              }
            >
              Apply
            </button>
            <button
              className="h-6 rounded border border-border px-2 text-[11px] text-muted"
              onClick={() =>
                run(SetTableCellBorderCommandId, {
                  sides: Array.from(borderSides),
                  color: null,
                  width: borderWidth,
                })
              }
            >
              Clear
            </button>
          </div>
          <GroupLabel>Borders</GroupLabel>
        </div>

        <Divider />

        {/* Vertical align */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <button
              className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted hover:text-foreground"
              title="Align top"
              onClick={() => run(SetTableCellVAlignCommandId, { vAlign: VerticalAlignmentType.TOP })}
            >
              <AlignVerticalJustifyStart size={14} />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted hover:text-foreground"
              title="Align middle"
              onClick={() => run(SetTableCellVAlignCommandId, { vAlign: VerticalAlignmentType.CENTER })}
            >
              <AlignVerticalJustifyCenter size={14} />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted hover:text-foreground"
              title="Align bottom"
              onClick={() => run(SetTableCellVAlignCommandId, { vAlign: VerticalAlignmentType.BOTTOM })}
            >
              <AlignVerticalJustifyEnd size={14} />
            </button>
          </div>
          <GroupLabel>Align</GroupLabel>
        </div>

        <Divider />

        {/* Row height */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <Rows3 size={13} className="text-muted" />
            <button
              className="h-6 rounded border border-border px-2 text-[11px] text-muted hover:text-foreground"
              onClick={() => run(SetTableRowHeightCommandId, { mode: "auto" })}
            >
              Auto
            </button>
            <input
              type="number"
              min={10}
              value={rowHeight}
              onChange={(e) => setRowHeight(Number(e.target.value))}
              className="h-6 w-12 rounded border border-border bg-background px-1 text-center"
            />
            <button
              className="h-6 rounded bg-white px-2 text-[11px] font-medium text-black"
              onClick={() => run(SetTableRowHeightCommandId, { mode: "fixed", height: rowHeight })}
            >
              Set
            </button>
          </div>
          <GroupLabel>Row height</GroupLabel>
        </div>

        <Divider />

        {/* Column width */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <Columns3 size={13} className="text-muted" />
            <input
              type="number"
              min={20}
              value={colWidth}
              onChange={(e) => setColWidth(Number(e.target.value))}
              className="h-6 w-12 rounded border border-border bg-background px-1 text-center"
            />
            <button
              className="h-6 rounded bg-white px-2 text-[11px] font-medium text-black"
              onClick={() => run(SetTableColumnWidthCommandId, { width: colWidth })}
            >
              Set
            </button>
          </div>
          <GroupLabel>Column width</GroupLabel>
        </div>

        <Divider />

        {/* Merge cells */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <button
              className="flex h-6 items-center gap-1 rounded bg-white px-2 text-[11px] font-medium text-black"
              onClick={() => run(MergeTableCellsCommandId)}
              title="Merge selected cells (same row)"
            >
              <Combine size={12} /> Merge
            </button>
          </div>
          <GroupLabel>Cells</GroupLabel>
        </div>

        <Divider />

        {/* Table fit */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <button
              className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted hover:text-foreground"
              onClick={() => run(SetTableLayoutCommandId, { layout: "auto" })}
            >
              <Square size={12} /> Content
            </button>
            <button
              className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted hover:text-foreground"
              onClick={() => run(SetTableLayoutCommandId, { layout: "fixed" })}
            >
              <SquareStack size={12} /> Fixed
            </button>
          </div>
          <GroupLabel>Fit</GroupLabel>
        </div>

        <Divider />

        {/* Style options */}
        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <input
              type="color"
              value={bandColor1}
              onChange={(e) => setBandColor1(e.target.value)}
              className="h-6 w-6 shrink-0 rounded border border-border bg-transparent"
              title="Odd row color"
            />
            <input
              type="color"
              value={bandColor2}
              onChange={(e) => setBandColor2(e.target.value)}
              className="h-6 w-6 shrink-0 rounded border border-border bg-transparent"
              title="Even row color"
            />
            <button
              className="h-6 rounded bg-white px-2 text-[11px] font-medium text-black"
              onClick={() =>
                run(SetTableBandedRowsCommandId, { enabled: true, colorOdd: bandColor1, colorEven: bandColor2 })
              }
            >
              Banded
            </button>
            <button
              className="h-6 rounded border border-border px-2 text-[11px] text-muted"
              onClick={() => run(SetTableBandedRowsCommandId, { enabled: false })}
            >
              Off
            </button>
          </div>
          <GroupLabel>Style</GroupLabel>
        </div>

        <Divider />

        <div className="flex flex-col items-center gap-1 px-1">
          <div className="flex items-center gap-1">
            <button
              className="h-6 rounded bg-white px-2 text-[11px] font-medium text-black"
              onClick={() => run(SetTableHeaderRowCommandId, { enabled: true })}
            >
              Header row
            </button>
            <button
              className="h-6 rounded border border-border px-2 text-[11px] text-muted"
              onClick={() => run(SetTableHeaderRowCommandId, { enabled: false })}
            >
              Off
            </button>
          </div>
          <GroupLabel>Options</GroupLabel>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent" />
      </div>
    </div>
  );
}
