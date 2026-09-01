import JSZip from "jszip";
import {
  BaselineOffset,
  BooleanNumber,
  HorizontalAlign,
  NamedStyleType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  SpacingRule,
  TableAlignmentType,
  TableRowHeightRule,
  TableSizeType,
  TableTextWrapType,
  TextDecoration,
} from "@univerjs/core";
import type {
  IDocumentBody,
  IDocumentData,
  IParagraph,
  IParagraphStyle,
  ITable,
  ITableCell,
  ITableColumn,
  ITableRow,
  ITextRun,
  ITextStyle,
} from "@univerjs/core";
import {
  DOCS_END,
  PARAGRAPH,
  TABLE_CELL_END,
  TABLE_CELL_START,
  TABLE_END,
  TABLE_ROW_END,
  TABLE_ROW_START,
  TABLE_START,
  TAB,
} from "./tokens";

// OOXML → Univer IDocumentData importer.
//
// A .docx is a ZIP whose main document lives in word/document.xml.
// All OOXML geometry is in twips (1/1440 inch); Univer works in 96-DPI
// pixels (1/96 inch). The data model for tables is split: the dataStream
// carries position tokens (TABLE_START … TABLE_END etc.) and the actual
// row/cell properties live in body.tableSource separately.

const TWIPS_PER_INCH = 1440;
const PX_PER_INCH = 96;

function twipsToPx(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * PX_PER_INCH);
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function wAttr(el: Element | null | undefined, localName: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, localName) ?? el.getAttribute(`w:${localName}`);
}

function wChildren(el: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (const child of el.children) {
    if (child.localName === localName) out.push(child as Element);
  }
  return out;
}

function wChild(el: Element | null | undefined, localName: string): Element | null {
  if (!el) return null;
  for (const child of el.children) {
    if (child.localName === localName) return child as Element;
  }
  return null;
}

// ─── ID generation ───────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix = "p"): string {
  return `${prefix}${++idCounter}`;
}

// ─── Style mappings ──────────────────────────────────────────────────────────

const STYLE_ID_TO_NAMED: Record<string, NamedStyleType> = {
  Title: NamedStyleType.TITLE,
  Subtitle: NamedStyleType.SUBTITLE,
  Heading1: NamedStyleType.HEADING_1,
  "Heading 1": NamedStyleType.HEADING_1,
  Heading2: NamedStyleType.HEADING_2,
  "Heading 2": NamedStyleType.HEADING_2,
  Heading3: NamedStyleType.HEADING_3,
  "Heading 3": NamedStyleType.HEADING_3,
  Heading4: NamedStyleType.HEADING_4,
  "Heading 4": NamedStyleType.HEADING_4,
  Heading5: NamedStyleType.HEADING_5,
  "Heading 5": NamedStyleType.HEADING_5,
};

const JC_TO_ALIGN: Record<string, HorizontalAlign> = {
  left: HorizontalAlign.LEFT,
  center: HorizontalAlign.CENTER,
  right: HorizontalAlign.RIGHT,
  both: HorizontalAlign.JUSTIFIED,
  distribute: HorizontalAlign.DISTRIBUTED,
};

function hexColor(val: string | null | undefined): string | null {
  if (!val || val === "auto" || val === "none") return null;
  const clean = val.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean.toUpperCase()}`;
  return null;
}

// ─── Run properties ──────────────────────────────────────────────────────────

function parseRunProps(rPr: Element | null): ITextStyle {
  if (!rPr) return {};
  const style: ITextStyle = {};

  const bEl = wChild(rPr, "b");
  if (bEl && wAttr(bEl, "val") !== "0") style.bl = BooleanNumber.TRUE;
  const iEl = wChild(rPr, "i");
  if (iEl && wAttr(iEl, "val") !== "0") style.it = BooleanNumber.TRUE;
  if (wChild(rPr, "strike")) style.st = { s: BooleanNumber.TRUE, t: TextDecoration.SINGLE };
  const uEl = wChild(rPr, "u");
  if (uEl && wAttr(uEl, "val") && wAttr(uEl, "val") !== "none") {
    style.ul = { s: BooleanNumber.TRUE, t: TextDecoration.SINGLE };
  }

  const colorEl = wChild(rPr, "color");
  const color = hexColor(wAttr(colorEl, "val"));
  if (color) style.cl = { rgb: color };

  const shdEl = wChild(rPr, "shd");
  const bg = hexColor(wAttr(shdEl, "fill"));
  if (bg) style.bg = { rgb: bg };

  const szEl = wChild(rPr, "sz") ?? wChild(rPr, "szCs");
  if (szEl) {
    const halfPts = parseInt(wAttr(szEl, "val") ?? "0", 10);
    if (halfPts > 0) style.fs = halfPts / 2;
  }

  const fontsEl = wChild(rPr, "rFonts");
  if (fontsEl) {
    const font = wAttr(fontsEl, "ascii") ?? wAttr(fontsEl, "hAnsi") ?? wAttr(fontsEl, "eastAsia");
    if (font) style.ff = font;
  }

  const vertEl = wChild(rPr, "vertAlign");
  if (vertEl) {
    if (wAttr(vertEl, "val") === "superscript") style.va = BaselineOffset.SUPERSCRIPT;
    else if (wAttr(vertEl, "val") === "subscript") style.va = BaselineOffset.SUBSCRIPT;
  }

  return style;
}

// ─── Paragraph properties ────────────────────────────────────────────────────

function parseParagraphProps(pPr: Element | null): {
  style: IParagraphStyle;
  listId: string | null;
  nestingLevel: number;
} {
  if (!pPr) return { style: {}, listId: null, nestingLevel: 0 };

  const style: IParagraphStyle = {};
  let listId: string | null = null;
  let nestingLevel = 0;

  const pStyleEl = wChild(pPr, "pStyle");
  const styleId = wAttr(pStyleEl, "val") ?? "";
  if (styleId && STYLE_ID_TO_NAMED[styleId] !== undefined) {
    style.namedStyleType = STYLE_ID_TO_NAMED[styleId];
  }

  const jcEl = wChild(pPr, "jc");
  const align = JC_TO_ALIGN[wAttr(jcEl, "val") ?? ""];
  if (align !== undefined) style.horizontalAlign = align;

  const spacingEl = wChild(pPr, "spacing");
  if (spacingEl) {
    const before = parseInt(wAttr(spacingEl, "before") ?? "0", 10);
    const after = parseInt(wAttr(spacingEl, "after") ?? "0", 10);
    const line = parseInt(wAttr(spacingEl, "line") ?? "0", 10);
    const lineRule = wAttr(spacingEl, "lineRule");
    if (before > 0) style.spaceAbove = { v: twipsToPx(before) };
    if (after > 0) style.spaceBelow = { v: twipsToPx(after) };
    if (line > 0) {
      if (lineRule === "auto") {
        style.lineSpacing = line / 240;
        style.spacingRule = SpacingRule.AUTO;
      } else if (lineRule === "exact") {
        style.lineSpacing = twipsToPx(line);
        style.spacingRule = SpacingRule.EXACT;
      } else {
        style.lineSpacing = twipsToPx(line);
        style.spacingRule = SpacingRule.AT_LEAST;
      }
    }
  }

  const indEl = wChild(pPr, "ind");
  if (indEl) {
    const left = parseInt(wAttr(indEl, "left") ?? "0", 10);
    const right = parseInt(wAttr(indEl, "right") ?? "0", 10);
    const firstLine = parseInt(wAttr(indEl, "firstLine") ?? "0", 10);
    const hanging = parseInt(wAttr(indEl, "hanging") ?? "0", 10);
    if (left > 0) style.indentStart = { v: twipsToPx(left) };
    if (right > 0) style.indentEnd = { v: twipsToPx(right) };
    if (firstLine > 0) style.indentFirstLine = { v: twipsToPx(firstLine) };
    if (hanging > 0) style.hanging = { v: twipsToPx(hanging) };
  }

  const shdEl = wChild(pPr, "shd");
  const bg = hexColor(wAttr(shdEl, "fill"));
  if (bg) style.shading = { backgroundColor: { rgb: bg } };

  if (wChild(pPr, "pageBreakBefore")) style.pageBreakBefore = BooleanNumber.TRUE;
  if (wChild(pPr, "keepLines")) style.keepLines = BooleanNumber.TRUE;
  if (wChild(pPr, "keepNext")) style.keepNext = BooleanNumber.TRUE;

  const numPrEl = wChild(pPr, "numPr");
  if (numPrEl) {
    const numIdEl = wChild(numPrEl, "numId");
    const ilvlEl = wChild(numPrEl, "ilvl");
    const numId = wAttr(numIdEl, "val") ?? "0";
    nestingLevel = parseInt(wAttr(ilvlEl, "val") ?? "0", 10);
    if (numId !== "0") listId = numId;
  }

  return { style, listId, nestingLevel };
}

// ─── Body builder ─────────────────────────────────────────────────────────────

interface BodyBuilder {
  stream: string;
  textRuns: ITextRun[];
  paragraphs: IParagraph[];
  /** ICustomTable entries (just position markers). */
  tables: Array<{ startIndex: number; endIndex: number; tableId: string }>;
  /** Actual table data keyed by tableId. */
  tableSource: Record<string, ITable>;
}

function makeBuilder(): BodyBuilder {
  return { stream: "", textRuns: [], paragraphs: [], tables: [], tableSource: {} };
}

function addRun(builder: BodyBuilder, text: string, style: ITextStyle) {
  if (!text) return;
  const st = builder.stream.length;
  builder.stream += text;
  const ed = builder.stream.length;
  if (Object.keys(style).length > 0) {
    builder.textRuns.push({ st, ed, ts: style });
  }
}

function addChar(builder: BodyBuilder, ch: string) {
  builder.stream += ch;
}

function mergeBuilder(target: BodyBuilder, sub: BodyBuilder, offset: number) {
  target.stream += sub.stream;
  for (const tr of sub.textRuns) target.textRuns.push({ st: tr.st + offset, ed: tr.ed + offset, ts: tr.ts });
  for (const p of sub.paragraphs) target.paragraphs.push({ ...p, startIndex: p.startIndex + offset });
  for (const t of sub.tables) {
    target.tables.push({ startIndex: t.startIndex + offset, endIndex: t.endIndex + offset, tableId: t.tableId });
    target.tableSource[t.tableId] = sub.tableSource[t.tableId];
  }
}

function convertParagraph(pEl: Element, builder: BodyBuilder): void {
  const pPr = wChild(pEl, "pPr");
  const { style: paragraphStyle, listId, nestingLevel } = parseParagraphProps(pPr);

  for (const child of pEl.children) {
    if (child.localName === "r") {
      const rPr = wChild(child as Element, "rPr");
      const ts = parseRunProps(rPr);
      for (const rc of child.children) {
        if (rc.localName === "t") {
          addRun(builder, rc.textContent ?? "", ts);
        } else if (rc.localName === "tab") {
          addRun(builder, TAB, ts);
        }
      }
    } else if (child.localName === "hyperlink") {
      for (const hChild of child.children) {
        if (hChild.localName !== "r") continue;
        const rPr = wChild(hChild as Element, "rPr");
        const ts: ITextStyle = {
          ...parseRunProps(rPr),
          cl: { rgb: "#0563C1" },
          ul: { s: BooleanNumber.TRUE, t: TextDecoration.SINGLE },
        };
        for (const rc of hChild.children) {
          if (rc.localName === "t") addRun(builder, rc.textContent ?? "", ts);
        }
      }
    }
  }

  addChar(builder, PARAGRAPH);
  const markIndex = builder.stream.length - 1;

  const para: IParagraph = { startIndex: markIndex, paragraphId: nextId("pid"), paragraphStyle };
  if (listId) {
    para.bullet = { listId, nestingLevel, listType: "unordered" };
  }
  // Paragraph-mark run style
  const pRPr = wChild(pPr, "rPr");
  if (pRPr) {
    const ts = parseRunProps(pRPr);
    if (Object.keys(ts).length > 0) {
      builder.textRuns.push({ st: markIndex, ed: markIndex + 1, ts });
    }
  }
  builder.paragraphs.push(para);
}

function convertTable(tblEl: Element, builder: BodyBuilder): void {
  const tableStart = builder.stream.length;
  addChar(builder, TABLE_START);
  const tableId = nextId("tbl");

  // Table cell margin defaults from tblPr/tblCellMar
  const tblPr = wChild(tblEl, "tblPr");
  const tblCellMar = wChild(tblPr, "tblCellMar");
  const cellMarginPx = {
    start: twipsToPx(parseInt(wAttr(wChild(tblCellMar, "left"), "w") ?? "108", 10)),
    end: twipsToPx(parseInt(wAttr(wChild(tblCellMar, "right"), "w") ?? "108", 10)),
    top: twipsToPx(parseInt(wAttr(wChild(tblCellMar, "top"), "w") ?? "0", 10)),
    bottom: twipsToPx(parseInt(wAttr(wChild(tblCellMar, "bottom"), "w") ?? "0", 10)),
  };

  const tableRows: ITableRow[] = [];

  for (const trEl of wChildren(tblEl, "tr")) {
    addChar(builder, TABLE_ROW_START);
    const cells: ITableCell[] = [];

    for (const tcEl of wChildren(trEl, "tc")) {
      addChar(builder, TABLE_CELL_START);

      const sub = makeBuilder();
      for (const cellChild of tcEl.children) {
        if (cellChild.localName === "p") convertParagraph(cellChild as Element, sub);
        else if (cellChild.localName === "tbl") convertTable(cellChild as Element, sub);
      }
      if (!sub.stream.includes(PARAGRAPH)) {
        sub.stream += PARAGRAPH;
        sub.paragraphs.push({ startIndex: sub.stream.length - 1, paragraphId: nextId("pid"), paragraphStyle: {} });
      }
      mergeBuilder(builder, sub, builder.stream.length);

      addChar(builder, TABLE_CELL_END);

      const tcPr = wChild(tcEl, "tcPr");
      const gridSpan = parseInt(wAttr(wChild(tcPr, "gridSpan"), "val") ?? "1", 10);
      const vMergeEl = wChild(tcPr, "vMerge");
      const vMergeAttr = wAttr(vMergeEl, "val");
      const cell: ITableCell = {};
      if (gridSpan > 1) cell.columnSpan = gridSpan;
      // "restart" means first cell of a vertical merge, no val or val="restart"
      if (vMergeEl && (vMergeAttr === null || vMergeAttr === "restart")) cell.rowSpan = 1;
      cells.push(cell);
    }

    addChar(builder, TABLE_ROW_END);

    // Row height from trPr
    const trPr = wChild(trEl, "trPr");
    const trHeight = wChild(trPr, "trHeight");
    const rowHeightTwips = parseInt(wAttr(trHeight, "val") ?? "0", 10);
    const hRule = wAttr(trHeight, "hRule");
    tableRows.push({
      tableCells: cells,
      trHeight: {
        val: { v: rowHeightTwips > 0 ? twipsToPx(rowHeightTwips) : 0 },
        hRule: hRule === "exact" ? TableRowHeightRule.EXACT : hRule === "atLeast" ? TableRowHeightRule.AT_LEAST : TableRowHeightRule.AUTO,
      },
      repeatHeaderRow: wChild(trPr, "tblHeader") ? BooleanNumber.TRUE : undefined,
      cantSplit: wChild(trPr, "cantSplit") ? BooleanNumber.TRUE : undefined,
    });
  }

  addChar(builder, TABLE_END);
  const tableEnd = builder.stream.length - 1;

  // Column widths from tblGrid
  const tblGrid = wChild(tblEl, "tblGrid");
  const tableColumns: ITableColumn[] = tblGrid
    ? wChildren(tblGrid, "gridCol").map((col) => ({
        size: { type: TableSizeType.SPECIFIED, width: { v: twipsToPx(parseInt(wAttr(col, "w") ?? "60", 10)) } },
      }))
    : [];

  // Total table width
  const totalWidthPx = tableColumns.reduce((s, c) => s + (c.size?.width?.v ?? 0), 0) || 400;

  const iTable: ITable = {
    tableId,
    tableRows,
    tableColumns,
    align: TableAlignmentType.START,
    indent: { v: 0 },
    textWrap: TableTextWrapType.NONE,
    position: {
      positionH: { relativeFrom: ObjectRelativeFromH.PAGE },
      positionV: { relativeFrom: ObjectRelativeFromV.PAGE },
    },
    dist: { distT: 0, distB: 0, distL: 0, distR: 0 },
    size: { type: TableSizeType.SPECIFIED, width: { v: totalWidthPx } },
    cellMargin: {
      start: { v: cellMarginPx.start },
      end: { v: cellMarginPx.end },
      top: { v: cellMarginPx.top },
      bottom: { v: cellMarginPx.bottom },
    },
  };

  builder.tables.push({ startIndex: tableStart, endIndex: tableEnd, tableId });
  builder.tableSource[tableId] = iTable;
}

function convertBody(bodyEl: Element): BodyBuilder {
  const builder = makeBuilder();
  for (const child of bodyEl.children) {
    if (child.localName === "p") convertParagraph(child as Element, builder);
    else if (child.localName === "tbl") convertTable(child as Element, builder);
    // sectPr handled separately
  }
  return builder;
}

// ─── Page geometry ────────────────────────────────────────────────────────────

interface PageGeometry {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

function parsePageGeometry(sectPr: Element | null): PageGeometry {
  const defaults: PageGeometry = { pageWidth: 794, pageHeight: 1123, marginTop: 96, marginBottom: 96, marginLeft: 96, marginRight: 96 };
  if (!sectPr) return defaults;
  const pgSz = wChild(sectPr, "pgSz");
  const pgMar = wChild(sectPr, "pgMar");
  return {
    pageWidth: pgSz ? twipsToPx(parseInt(wAttr(pgSz, "w") ?? "0", 10)) || defaults.pageWidth : defaults.pageWidth,
    pageHeight: pgSz ? twipsToPx(parseInt(wAttr(pgSz, "h") ?? "0", 10)) || defaults.pageHeight : defaults.pageHeight,
    marginTop: pgMar ? twipsToPx(parseInt(wAttr(pgMar, "top") ?? "0", 10)) || defaults.marginTop : defaults.marginTop,
    marginBottom: pgMar ? twipsToPx(parseInt(wAttr(pgMar, "bottom") ?? "0", 10)) || defaults.marginBottom : defaults.marginBottom,
    marginLeft: pgMar ? twipsToPx(parseInt(wAttr(pgMar, "left") ?? "0", 10)) || defaults.marginLeft : defaults.marginLeft,
    marginRight: pgMar ? twipsToPx(parseInt(wAttr(pgMar, "right") ?? "0", 10)) || defaults.marginRight : defaults.marginRight,
  };
}

// ─── Body → IDocumentBody ────────────────────────────────────────────────────

function builderToBody(builder: BodyBuilder): { body: IDocumentBody; tableSource: Record<string, ITable> } {
  const body: IDocumentBody = {
    dataStream: builder.stream + DOCS_END,
    textRuns: builder.textRuns.length ? builder.textRuns : [],
    paragraphs: builder.paragraphs.length
      ? builder.paragraphs
      : [{ startIndex: 0, paragraphId: nextId("pid"), paragraphStyle: {} }],
  };
  if (builder.tables.length) {
    body.tables = builder.tables;
  }
  return { body, tableSource: builder.tableSource };
}

// ─── Header/footer ────────────────────────────────────────────────────────────

async function parseHeaderFooter(
  zip: JSZip,
  rels: Map<string, { target: string }>,
  refId: string,
): Promise<{ body: IDocumentBody; tableSource: Record<string, ITable> } | null> {
  const rel = rels.get(refId);
  if (!rel) return null;
  const path = rel.target.startsWith("word/") ? rel.target : `word/${rel.target}`;
  const xml = await zip.file(path)?.async("string");
  if (!xml) return null;
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const root = dom.documentElement;
  const builder = makeBuilder();
  for (const child of root.children) {
    if (child.localName === "p") convertParagraph(child as Element, builder);
    else if (child.localName === "tbl") convertTable(child as Element, builder);
  }
  return builderToBody(builder);
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function importDocxFromFile(file: File): Promise<IDocumentData> {
  // Reset ID counter for each import to keep IDs stable and short.
  idCounter = 0;

  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("Not a valid .docx file: word/document.xml not found");

  const parser = new DOMParser();
  const docDom = parser.parseFromString(docXml, "application/xml");
  const bodyEl = docDom.querySelector("body");
  if (!bodyEl) throw new Error("No <w:body> element in document.xml");

  const builder = convertBody(bodyEl);
  const sectPr = wChild(bodyEl, "sectPr");
  const geom = parsePageGeometry(sectPr);

  // Parse relationships
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const rels = new Map<string, { target: string; type: string }>();
  if (relsXml) {
    const relsDom = parser.parseFromString(relsXml, "application/xml");
    for (const rel of relsDom.querySelectorAll("Relationship")) {
      const id = rel.getAttribute("Id") ?? "";
      rels.set(id, {
        target: rel.getAttribute("Target") ?? "",
        type: rel.getAttribute("Type") ?? "",
      });
    }
  }

  // Parse headers/footers from sectPr references
  const headers: IDocumentData["headers"] = {};
  const footers: IDocumentData["footers"] = {};
  // Collect all tableSource entries from body + headers + footers
  const tableSource: Record<string, ITable> = {};

  if (sectPr) {
    for (const ref of sectPr.querySelectorAll("headerReference")) {
      const id = wAttr(ref as Element, "id") ?? ref.getAttribute("r:id") ?? "";
      const result = await parseHeaderFooter(zip, rels, id);
      if (result) {
        const headerId = nextId("hdr");
        headers![headerId] = { headerId, body: result.body };
        Object.assign(tableSource, result.tableSource);
      }
    }
    for (const ref of sectPr.querySelectorAll("footerReference")) {
      const id = wAttr(ref as Element, "id") ?? ref.getAttribute("r:id") ?? "";
      const result = await parseHeaderFooter(zip, rels, id);
      if (result) {
        const footerId = nextId("ftr");
        footers![footerId] = { footerId, body: result.body };
        Object.assign(tableSource, result.tableSource);
      }
    }
  }

  const { body, tableSource: bodyTableSource } = builderToBody(builder);
  Object.assign(tableSource, bodyTableSource);

  const title = file.name.replace(/\.docx$/i, "");
  const defaultHeaderId = Object.keys(headers ?? {}).at(0);
  const defaultFooterId = Object.keys(footers ?? {}).at(0);

  const data: IDocumentData = {
    id: `doc_${Date.now()}`,
    title,
    body,
    documentStyle: {
      pageSize: { width: geom.pageWidth, height: geom.pageHeight },
      marginTop: geom.marginTop,
      marginBottom: geom.marginBottom,
      marginLeft: geom.marginLeft,
      marginRight: geom.marginRight,
      defaultHeaderId,
      defaultFooterId,
      renderConfig: {
        verticalAlign: 2,
        horizontalAlign: 0,
        centerAngle: 0,
        vertexAngle: 0,
        wrapStrategy: 0,
        background: { rgb: "#FFFFFF" },
      },
    },
  };

  if (Object.keys(tableSource).length) data.tableSource = tableSource;
  if (Object.keys(headers ?? {}).length) data.headers = headers;
  if (Object.keys(footers ?? {}).length) data.footers = footers;

  return data;
}
