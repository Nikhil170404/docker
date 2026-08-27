import {
  BaselineOffset,
  BooleanNumber,
  HorizontalAlign,
  NamedStyleType,
  PageOrientType,
  SpacingRule,
  TableAlignmentType,
  TableLayoutType,
  TableRowHeightRule,
  TableSizeType,
  TableTextWrapType,
  ObjectRelativeFromH,
  ObjectRelativeFromV,
  VerticalAlignmentType,
} from "@univerjs/core";
import type {
  ICustomTable,
  IDocumentBody,
  IDocumentData,
  IDocumentStyle,
  IParagraph,
  ISectionBreak,
  ITable,
  ITableCell,
  ITableRow,
  ITextRun,
  ITextStyle,
} from "@univerjs/core";
import { readZip, readZipText } from "./unzip";
import {
  PARAGRAPH,
  SECTION_BREAK,
  TABLE_CELL_END,
  TABLE_CELL_START,
  TABLE_END,
  TABLE_ROW_END,
  TABLE_ROW_START,
  TABLE_START,
} from "./tokens";

// WordprocessingML -> Univer's data model: the exact inverse of ooxml.ts.
// Keeping the two files symmetrical is deliberate — every mapping here has a
// counterpart there, so a round trip (export then re-import) should land back
// on the same document, and that round trip is the cheapest regression test
// this importer has.

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** OOXML measures in twips; the document model is 96-DPI pixels. */
const TWIPS_PER_PX = 15;
const DEFAULT_FONT_SIZE = 11;

const twipsToPx = (twips: number) => twips / TWIPS_PER_PX;

/** Word style id -> Univer named style. Inverse of NAMED_STYLE_IDS. */
const NAMED_STYLES: Record<string, NamedStyleType> = {
  Title: NamedStyleType.TITLE,
  Subtitle: NamedStyleType.SUBTITLE,
  Heading1: NamedStyleType.HEADING_1,
  Heading2: NamedStyleType.HEADING_2,
  Heading3: NamedStyleType.HEADING_3,
  Heading4: NamedStyleType.HEADING_4,
  Heading5: NamedStyleType.HEADING_5,
};

const ALIGNMENTS: Record<string, HorizontalAlign> = {
  left: HorizontalAlign.LEFT,
  start: HorizontalAlign.LEFT,
  center: HorizontalAlign.CENTER,
  right: HorizontalAlign.RIGHT,
  end: HorizontalAlign.RIGHT,
  both: HorizontalAlign.JUSTIFIED,
  distribute: HorizontalAlign.DISTRIBUTED,
};

const CELL_V_ALIGN: Record<string, VerticalAlignmentType> = {
  top: VerticalAlignmentType.TOP,
  center: VerticalAlignmentType.CENTER,
  bottom: VerticalAlignmentType.BOTTOM,
};

/* ------------------------------------------------------------------ */
/* Small DOM helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Descendant lookup by local name, in the WordprocessingML namespace.
 *
 * Deliberately not `getElementsByTagNameNS`: implementations disagree about
 * it for XML documents (happy-dom returns nothing at all, even though it
 * parses `namespaceURI` correctly), and a document that opens in one engine
 * but not another is exactly the class of bug this format punishes you for.
 * `localName` + `namespaceURI` is the part everyone implements the same way.
 */
function firstDescendant(parent: Element | null, name: string): Element | null {
  if (!parent) return null;
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.localName === name && el.namespaceURI === W_NS) return el;
    const nested = firstDescendant(el, name);
    if (nested) return nested;
  }
  return null;
}

/** Every descendant with this local name, in document order. */
function allDescendants(parent: Element | null, name: string): Element[] {
  if (!parent) return [];
  const out: Element[] = [];
  const walk = (node: Element) => {
    for (const candidate of Array.from(node.childNodes)) {
      if (candidate.nodeType !== 1) continue;
      const el = candidate as Element;
      if (el.localName === name && el.namespaceURI === W_NS) out.push(el);
      walk(el);
    }
  };
  walk(parent);
  return out;
}

const child = (parent: Element | null, name: string): Element | null =>
  firstDescendant(parent, name);

/** Direct children only — `w:p` inside a nested table must not leak out. */
function directChildren(parent: Element, name: string): Element[] {
  const out: Element[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.localName === name && el.namespaceURI === W_NS) out.push(el);
    }
  }
  return out;
}

/**
 * Reads a `w:`-namespaced attribute.
 *
 * Same caution as the element lookup above: `getAttributeNS` is unreliable
 * across XML DOM implementations, so the prefixed literal is tried next, and
 * finally the bare name — which is what a document that declares the w
 * namespace as its default would carry.
 */
function attr(el: Element | null, name: string): string | null {
  if (!el) return null;
  return (
    el.getAttributeNS(W_NS, name) ??
    el.getAttribute(`w:${name}`) ??
    el.getAttribute(name)
  );
}

function numAttr(el: Element | null, name: string): number | null {
  const raw = attr(el, name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * A toggle element (`<w:b/>`, `<w:i/>`) is on when present unless it carries
 * an explicit falsy `w:val` — Word writes `<w:b w:val="0"/>` to turn bold
 * off again inside a run that inherits it.
 */
function isToggleOn(parent: Element | null, name: string): boolean {
  const el = child(parent, name);
  if (!el) return false;
  const val = attr(el, "val");
  return val === null || !(val === "0" || val === "false" || val === "off");
}

function hexColor(value: string | null): string | null {
  if (!value || value === "auto") return null;
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toUpperCase()}` : null;
}

/* ------------------------------------------------------------------ */
/* Run and paragraph properties                                        */
/* ------------------------------------------------------------------ */

function readTextStyle(rPr: Element | null): ITextStyle {
  const style: ITextStyle = {};
  if (!rPr) return style;

  const font = attr(child(rPr, "rFonts"), "ascii");
  if (font) style.ff = font;

  if (isToggleOn(rPr, "b")) style.bl = BooleanNumber.TRUE;
  if (isToggleOn(rPr, "i")) style.it = BooleanNumber.TRUE;
  if (isToggleOn(rPr, "strike")) style.st = { s: BooleanNumber.TRUE };

  const underline = child(rPr, "u");
  if (underline && attr(underline, "val") !== "none") {
    style.ul = { s: BooleanNumber.TRUE };
  }

  const color = hexColor(attr(child(rPr, "color"), "val"));
  if (color) style.cl = { rgb: color };

  const fill = hexColor(attr(child(rPr, "shd"), "fill"));
  if (fill) style.bg = { rgb: fill };

  // OOXML font sizes are half-points.
  const halfPoints = numAttr(child(rPr, "sz"), "val");
  if (halfPoints !== null) style.fs = halfPoints / 2;

  const vertAlign = attr(child(rPr, "vertAlign"), "val");
  if (vertAlign === "subscript") style.va = BaselineOffset.SUBSCRIPT;
  if (vertAlign === "superscript") style.va = BaselineOffset.SUPERSCRIPT;

  return style;
}

interface ParagraphProps {
  paragraph: IParagraph;
  /** Style carried by the paragraph mark, applied to runs that lack their own. */
  markStyle: ITextStyle;
}

function readParagraphProps(pPr: Element | null, index: number): ParagraphProps {
  const paragraph = { startIndex: index } as IParagraph;
  const style: NonNullable<IParagraph["paragraphStyle"]> = {};

  if (!pPr) return { paragraph, markStyle: {} };

  const styleId = attr(child(pPr, "pStyle"), "val");
  if (styleId && NAMED_STYLES[styleId]) style.namedStyleType = NAMED_STYLES[styleId];

  const numPr = child(pPr, "numPr");
  if (numPr) {
    const numId = numAttr(child(numPr, "numId"), "val") ?? 0;
    const level = numAttr(child(numPr, "ilvl"), "val") ?? 0;
    paragraph.bullet = {
      listId: `list-${numId}`,
      listType: "BULLET_LIST",
      nestingLevel: level,
      textStyle: {},
    };
  }

  const shading = hexColor(attr(child(pPr, "shd"), "fill"));
  if (shading) style.shading = { backgroundColor: { rgb: shading } };

  const spacing = child(pPr, "spacing");
  if (spacing) {
    const before = numAttr(spacing, "before");
    const after = numAttr(spacing, "after");
    if (before !== null) style.spaceAbove = { v: twipsToPx(before) };
    if (after !== null) style.spaceBelow = { v: twipsToPx(after) };

    const line = numAttr(spacing, "line");
    const rule = attr(spacing, "lineRule");
    if (line !== null) {
      if (rule === "auto") {
        // Word counts auto line spacing in 240ths of a line.
        style.lineSpacing = line / 240;
        style.spacingRule = SpacingRule.AUTO;
      } else {
        style.lineSpacing = twipsToPx(line);
        style.spacingRule = rule === "exact" ? SpacingRule.EXACT : SpacingRule.AT_LEAST;
      }
    }
  }

  const indent = child(pPr, "ind");
  if (indent) {
    const left = numAttr(indent, "left");
    const right = numAttr(indent, "right");
    const firstLine = numAttr(indent, "firstLine");
    const hanging = numAttr(indent, "hanging");
    if (left !== null) style.indentStart = { v: twipsToPx(left) };
    if (right !== null) style.indentEnd = { v: twipsToPx(right) };
    if (firstLine !== null) style.indentFirstLine = { v: twipsToPx(firstLine) };
    if (hanging !== null) style.hanging = { v: twipsToPx(hanging) };
  }

  const align = attr(child(pPr, "jc"), "val");
  if (align && ALIGNMENTS[align] !== undefined) style.horizontalAlign = ALIGNMENTS[align];

  if (child(pPr, "pageBreakBefore")) style.pageBreakBefore = BooleanNumber.TRUE;
  if (child(pPr, "keepLines")) style.keepLines = BooleanNumber.TRUE;
  if (child(pPr, "keepNext")) style.keepNext = BooleanNumber.TRUE;
  const widow = child(pPr, "widowControl");
  if (widow && attr(widow, "val") === "0") style.widowControl = BooleanNumber.FALSE;

  const markStyle = readTextStyle(child(pPr, "rPr"));
  if (Object.keys(markStyle).length) style.textStyle = markStyle;

  if (Object.keys(style).length) paragraph.paragraphStyle = style;
  return { paragraph, markStyle };
}

/* ------------------------------------------------------------------ */
/* Body builder                                                        */
/* ------------------------------------------------------------------ */

/**
 * Accumulates the dataStream and its parallel index arrays. Everything in
 * Univer's model is anchored by character offset, so the stream and the
 * arrays have to grow together — hence one builder rather than a pure map.
 */
class BodyBuilder {
  stream = "";
  private idCounter = 0;

  /** Univer requires a unique id on every paragraph and section break. */
  private nextId(prefix: string): string {
    return `${prefix}-${++this.idCounter}`;
  }

  textRuns: ITextRun[] = [];
  paragraphs: IParagraph[] = [];
  sectionBreaks: ISectionBreak[] = [];
  tables: ICustomTable[] = [];
  tableSource: Record<string, ITable> = {};
  private tableCounter = 0;

  get length(): number {
    return this.stream.length;
  }

  pushToken(token: string) {
    this.stream += token;
  }

  /** Appends run text and records its style span. */
  pushRun(text: string, style: ITextStyle) {
    if (!text) return;
    const st = this.stream.length;
    this.stream += text;
    if (Object.keys(style).length) {
      this.textRuns.push({ st, ed: this.stream.length, ts: style });
    }
  }

  /** Closes a paragraph: the mark is a character in the stream. */
  endParagraph(props: ParagraphProps) {
    props.paragraph.startIndex = this.stream.length;
    props.paragraph.paragraphId = this.nextId("p");
    this.paragraphs.push(props.paragraph);
    this.stream += PARAGRAPH;
  }

  endSection() {
    this.sectionBreaks.push({
      startIndex: this.stream.length,
      sectionId: this.nextId("s"),
    });
    this.stream += SECTION_BREAK;
  }

  nextTableId(): string {
    return `docx-table-${++this.tableCounter}`;
  }
}

function readParagraph(p: Element, builder: BodyBuilder) {
  const props = readParagraphProps(child(p, "pPr"), builder.length);

  // Runs, hyperlinks and their nested runs, in document order.
  const walkRuns = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.namespaceURI !== W_NS) continue;

      if (el.localName === "hyperlink") {
        walkRuns(el);
        continue;
      }
      if (el.localName !== "r") continue;

      const style = readTextStyle(child(el, "rPr"));
      // A run with no styling of its own inherits the paragraph mark's,
      // which is how Word carries heading formatting.
      const effective = Object.keys(style).length ? style : props.markStyle;

      for (const runChild of Array.from(el.childNodes)) {
        if (runChild.nodeType !== 1) continue;
        const c = runChild as Element;
        if (c.namespaceURI !== W_NS) continue;

        if (c.localName === "t") {
          builder.pushRun(c.textContent ?? "", effective);
        } else if (c.localName === "tab") {
          builder.pushRun("\t", effective);
        } else if (c.localName === "br") {
          // A soft break inside a paragraph becomes its own paragraph:
          // the model has no intra-paragraph line break.
          builder.endParagraph(readParagraphProps(child(p, "pPr"), builder.length));
        }
      }
    }
  };

  walkRuns(p);
  builder.endParagraph(props);
}

/** A paragraph with no text, tab or break of its own. */
function isEmptyParagraph(p: Element): boolean {
  if (allDescendants(p, "tab").length > 0) return false;
  if (allDescendants(p, "br").length > 0) return false;
  return allDescendants(p, "t").every((el) => (el.textContent ?? "").length === 0);
}

/**
 * Walks a run of block-level elements (the body's, or one table cell's).
 *
 * Tables are the reason this is a shared helper rather than two loops: a
 * table emits its own trailing paragraph, and Word always writes a `w:p`
 * after `w:tbl`. When that paragraph is empty it *is* the trailing one, so
 * it gets consumed here — otherwise exporting and re-importing a document
 * would add a blank line under every table, every time.
 */
function readBlocks(blocks: Element[], builder: BodyBuilder) {
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    if (el.localName === "p") {
      readParagraph(el, builder);
    } else if (el.localName === "tbl") {
      readTable(el, builder);
      const next = blocks[i + 1];
      if (next && next.localName === "p" && isEmptyParagraph(next)) i++;
    }
  }
}

/** Block-level children of `parent`, in document order. */
function blockChildren(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (n) =>
      n.nodeType === 1 &&
      (n as Element).namespaceURI === W_NS &&
      ((n as Element).localName === "p" || (n as Element).localName === "tbl"),
  ) as Element[];
}

function readTable(tbl: Element, builder: BodyBuilder) {
  const startIndex = builder.length;
  const tableId = builder.nextTableId();
  builder.pushToken(TABLE_START);

  const grid = child(tbl, "tblGrid");
  const columnWidths = grid
    ? directChildren(grid, "gridCol").map((col) => twipsToPx(numAttr(col, "w") ?? 1500))
    : [];

  const rows: ITableRow[] = [];

  for (const tr of directChildren(tbl, "tr")) {
    builder.pushToken(TABLE_ROW_START);
    const cells: ITableCell[] = [];

    for (const tc of directChildren(tr, "tc")) {
      builder.pushToken(TABLE_CELL_START);

      const tcPr = child(tc, "tcPr");
      const cell: ITableCell = {};

      const width = numAttr(child(tcPr, "tcW"), "w");
      if (width) {
        cell.size = { type: TableSizeType.SPECIFIED, width: { v: twipsToPx(width) } };
      }
      const fill = hexColor(attr(child(tcPr, "shd"), "fill"));
      if (fill) cell.backgroundColor = { rgb: fill };
      const vAlign = attr(child(tcPr, "vAlign"), "val");
      if (vAlign && CELL_V_ALIGN[vAlign] !== undefined) cell.vAlign = CELL_V_ALIGN[vAlign];
      const span = numAttr(child(tcPr, "gridSpan"), "val");
      if (span && span > 1) cell.columnSpan = span;

      const blocks = blockChildren(tc);
      readBlocks(blocks, builder);
      // Univer requires at least one paragraph inside every cell.
      if (blocks.length === 0) {
        builder.endParagraph({ paragraph: { startIndex: 0 } as IParagraph, markStyle: {} });
      }

      // Every cell closes with a section break before its end token —
      // this is the shape Univer's own genEmptyTable produces.
      builder.endSection();
      builder.pushToken(TABLE_CELL_END);
      cells.push(cell);
    }

    builder.pushToken(TABLE_ROW_END);

    const trPr = child(tr, "trPr");
    const height = numAttr(child(trPr, "trHeight"), "val");
    const hRule = attr(child(trPr, "trHeight"), "hRule");
    rows.push({
      tableCells: cells,
      trHeight: {
        val: { v: height ? twipsToPx(height) : 30 },
        hRule:
          height === null
            ? TableRowHeightRule.AUTO
            : hRule === "exact"
              ? TableRowHeightRule.EXACT
              : TableRowHeightRule.AT_LEAST,
      },
      ...(child(trPr, "tblHeader") ? { repeatHeaderRow: BooleanNumber.TRUE } : {}),
      ...(child(trPr, "cantSplit") ? { cantSplit: BooleanNumber.TRUE } : {}),
    });
  }

  builder.pushToken(TABLE_END);
  const tableEndBoundary = builder.length;
  // Univer always closes a table with a paragraph mark of its own, before any
  // following content (confirmed against a table built by its own Insert >
  // Table command: `...TABLE_END, PARAGRAPH, ...`). Running the next
  // paragraph's text straight on from TABLE_END instead leaves the renderer
  // advancing its run cursor across the table's whole span, which shows up as
  // formatting from inside the table reappearing in the paragraph after it.
  // Word requires a `w:p` after every `w:tbl` too, so nothing is invented here.
  builder.endParagraph({ paragraph: { startIndex: 0 } as IParagraph, markStyle: {} });

  // A row can carry more cells than tblGrid declared (or the grid can be
  // missing); pad so every cell has a column to size itself from.
  const columnCount = Math.max(
    columnWidths.length,
    ...rows.map((r) => r.tableCells.length),
    1,
  );
  const widths = Array.from(
    { length: columnCount },
    (_, i) => columnWidths[i] ?? columnWidths[columnWidths.length - 1] ?? 1500 / TWIPS_PER_PX,
  );
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);

  // Exclusive, and measured to the TABLE_END sentinel rather than to the
  // current stream end: validateTableMetadata requires dataStream[endIndex - 1]
  // to be TABLE_END, and the trailing paragraph above sits outside the table.
  builder.tables.push({ startIndex, endIndex: tableEndBoundary, tableId });
  builder.tableSource[tableId] = {
    tableId,
    tableRows: rows,
    tableColumns: widths.map((w) => ({
      size: { type: TableSizeType.SPECIFIED, width: { v: w } },
    })),
    align: TableAlignmentType.START,
    indent: { v: twipsToPx(numAttr(child(child(tbl, "tblPr"), "tblInd"), "w") ?? 0) },
    textWrap: TableTextWrapType.NONE,
    position: {
      positionH: { relativeFrom: ObjectRelativeFromH.PAGE, posOffset: 0 },
      positionV: { relativeFrom: ObjectRelativeFromV.PAGE, posOffset: 0 },
    },
    dist: { distT: 0, distB: 0, distL: 0, distR: 0 },
    size: { type: TableSizeType.UNSPECIFIED, width: { v: totalWidth } },
    cellMargin: { start: { v: 10 }, end: { v: 10 }, top: { v: 5 }, bottom: { v: 5 } },
    layout: TableLayoutType.FIXED,
  };
}

/* ------------------------------------------------------------------ */
/* Section geometry                                                    */
/* ------------------------------------------------------------------ */

function readDocumentStyle(sectPr: Element | null): IDocumentStyle {
  const style: IDocumentStyle = {};
  if (!sectPr) return style;

  const pgSz = child(sectPr, "pgSz");
  const width = numAttr(pgSz, "w");
  const height = numAttr(pgSz, "h");
  if (width && height) {
    style.pageSize = { width: twipsToPx(width), height: twipsToPx(height) };
  }
  if (attr(pgSz, "orient") === "landscape") {
    style.pageOrient = PageOrientType.LANDSCAPE;
  }

  const pgMar = child(sectPr, "pgMar");
  if (pgMar) {
    const top = numAttr(pgMar, "top");
    const bottom = numAttr(pgMar, "bottom");
    const left = numAttr(pgMar, "left");
    const right = numAttr(pgMar, "right");
    if (top !== null) style.marginTop = twipsToPx(top);
    if (bottom !== null) style.marginBottom = twipsToPx(bottom);
    if (left !== null) style.marginLeft = twipsToPx(left);
    if (right !== null) style.marginRight = twipsToPx(right);
  }

  return style;
}

/**
 * Fills the gaps between styled runs with default-styled ones, so the runs
 * cover every character in the stream contiguously.
 *
 * Univer's inline walkers advance a single shared cursor across the whole
 * textRuns array rather than per paragraph, so a sparse array lets a run
 * defined late in the document be matched against an earlier slice — which
 * shows up as bold text appearing in a paragraph that never had any. The
 * export path hit the same bug in convertBodyToHtml and fixed it the same
 * way (see doc-export.ts); tiling makes every slice find a run that already
 * covers it, so the fall-through never happens.
 */
function tileTextRuns(runs: ITextRun[], streamLength: number): ITextRun[] {
  if (runs.length === 0) return runs;

  const sorted = [...runs].sort((a, b) => a.st - b.st);
  const tiled: ITextRun[] = [];
  let cursor = 0;

  for (const run of sorted) {
    if (run.st > cursor) tiled.push({ st: cursor, ed: run.st, ts: {} });
    tiled.push(run);
    cursor = run.ed;
  }
  if (cursor < streamLength) tiled.push({ st: cursor, ed: streamLength, ts: {} });

  return tiled;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export interface DocxImportResult {
  document: IDocumentData;
  /** Things that were dropped, so the UI can be honest about fidelity. */
  warnings: string[];
}

/**
 * Reads a .docx into a Univer document.
 *
 * Coverage is paragraphs and their formatting, character styling, headings,
 * lists, tables and page geometry. Images, headers/footers, footnotes and
 * embedded objects are not carried over yet and are reported in `warnings`
 * rather than silently dropped.
 */
export async function importDocx(
  file: ArrayBuffer,
  fileName: string,
): Promise<DocxImportResult> {
  const archive = await readZip(file);
  const xml = readZipText(archive, "word/document.xml");
  if (!xml) {
    throw new Error("This file is not a Word document (no word/document.xml).");
  }

  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.getElementsByTagName("parsererror").length > 0) {
    throw new Error("This document's XML could not be parsed.");
  }

  const bodyEl = firstDescendant(dom.documentElement, "body");
  if (!bodyEl) throw new Error("This document has no body.");

  const builder = new BodyBuilder();
  const warnings: string[] = [];

  readBlocks(blockChildren(bodyEl), builder);

  // A document must end with at least one paragraph and a section break.
  if (builder.paragraphs.length === 0) {
    builder.endParagraph({ paragraph: { startIndex: 0 } as IParagraph, markStyle: {} });
  }
  builder.endSection();

  if (archive.files.size && [...archive.files.keys()].some((p) => p.startsWith("word/media/"))) {
    warnings.push("Images were not imported.");
  }
  if (allDescendants(dom.documentElement, "headerReference").length > 0) {
    warnings.push("Headers and footers were not imported.");
  }
  if (allDescendants(dom.documentElement, "footnoteReference").length > 0) {
    warnings.push("Footnotes were not imported.");
  }

  const body: IDocumentBody = {
    dataStream: builder.stream,
    textRuns: tileTextRuns(builder.textRuns, builder.stream.length),
    paragraphs: builder.paragraphs,
    sectionBreaks: builder.sectionBreaks,
    ...(builder.tables.length ? { tables: builder.tables } : {}),
  };

  const documentStyle = readDocumentStyle(child(bodyEl, "sectPr"));

  return {
    document: {
      id: `docx-${Date.now()}`,
      title: fileName.replace(/\.docx$/i, "") || "Imported document",
      body,
      documentStyle: {
        ...documentStyle,
        // Anything the file didn't specify keeps the app's own defaults.
        fontSize: DEFAULT_FONT_SIZE,
      },
      ...(builder.tables.length ? { tableSource: builder.tableSource } : {}),
    } as IDocumentData,
    warnings,
  };
}
