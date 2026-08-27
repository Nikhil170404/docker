import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createZipBlob, textToBytes } from "../../src/lib/univer/docx/zip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * A .docx that exercises the properties a real contract actually uses:
 * heading styles, mixed character formatting, a bulleted list, a table with
 * a shaded repeating header row, and A4 page geometry.
 */
const CONTRACT_BODY = `
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Master Services Agreement</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="both"/><w:spacing w:before="120" w:after="240"/></w:pPr>
  <w:r><w:t xml:space="preserve">This agreement is made between </w:t></w:r>
  <w:r><w:rPr><w:b/></w:rPr><w:t>Acme Corp</w:t></w:r>
  <w:r><w:t xml:space="preserve"> and the </w:t></w:r>
  <w:r><w:rPr><w:i/><w:color w:val="C00000"/></w:rPr><w:t>Client</w:t></w:r>
  <w:r><w:t>.</w:t></w:r>
</w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1. Fees</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Payable within 30 days.</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Late fees apply.</w:t></w:r></w:p>
<w:tbl>
  <w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>
  <w:tr><w:trPr><w:tblHeader/></w:trPr>
    <w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Service</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Rate</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Consulting</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>INR 9,500 / day</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
<w:p><w:r><w:t>Signed on the date below.</w:t></w:r></w:p>
<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
</w:sectPr>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export const FIXTURE_DIR = join(process.cwd(), "tests/e2e/.fixtures");

/** Writes the contract fixture to disk once and returns its path. */
export async function contractDocxPath(): Promise<string> {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, "contract.docx");
  if (existsSync(path)) return path;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${CONTRACT_BODY}</w:body></w:document>`;

  const blob = createZipBlob(
    [
      { name: "[Content_Types].xml", data: textToBytes(CONTENT_TYPES) },
      { name: "_rels/.rels", data: textToBytes(RELS) },
      { name: "word/document.xml", data: textToBytes(document) },
    ],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
  return path;
}

/** Everything the assertions care about, read out of the autosaved snapshot. */
export const READ_MODEL = `() => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const d = JSON.parse(raw);
  const controls = new RegExp("[\\\\u0000-\\\\u001f]", "g");
  const table = Object.values(d.tableSource || {})[0];
  return {
    title: d.title,
    plain: (d.body?.dataStream || "").replace(controls, " ").replace(/\\s+/g, " ").trim(),
    paragraphs: d.body?.paragraphs?.length ?? 0,
    tables: d.body?.tables?.length ?? 0,
    rows: table?.tableRows?.length ?? null,
    columns: table?.tableColumns?.length ?? null,
    headerRow: table?.tableRows?.[0]?.repeatHeaderRow ?? null,
    cellShading: table?.tableRows?.[0]?.tableCells?.[0]?.backgroundColor?.rgb ?? null,
    headings: (d.body?.paragraphs ?? []).filter((p) => p.paragraphStyle?.namedStyleType).map((p) => p.paragraphStyle.namedStyleType),
    bulleted: (d.body?.paragraphs ?? []).filter((p) => p.bullet).length,
    bold: (d.body?.textRuns ?? []).filter((r) => r.ts?.bl === 1).length,
    italic: (d.body?.textRuns ?? []).filter((r) => r.ts?.it === 1).length,
    colours: (d.body?.textRuns ?? []).filter((r) => r.ts?.cl).map((r) => r.ts.cl.rgb),
    pageWidth: d.documentStyle?.pageSize?.width ?? null,
    marginLeft: d.documentStyle?.marginLeft ?? null,
  };
}`;

/**
 * Builds the reader for a given localStorage key, as an immediately-invoked
 * expression. `page.evaluate` given a bare function expression would hand
 * back the function object rather than calling it — which silently yields
 * `undefined` and lets assertions pass against nothing.
 */
export const readModelFor = (storageKey: string) =>
  `(${READ_MODEL.replace("STORAGE_KEY", JSON.stringify(`dockaro:${storageKey}`))})()`;
