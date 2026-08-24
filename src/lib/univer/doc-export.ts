import type { IDocumentData } from "@univerjs/core";
import { convertBodyToHtml } from "@univerjs/docs-ui";

// Real .docx (OOXML) export needs @univerjs-pro/docs-exchange-client — Pro
// only, and Pro purchases are paused company-wide (see table-style-
// commands.ts's merge-command comment for the same gate on drag-resize).
// convertBodyToHtml is the one export-adjacent piece that ships in the
// open-source packages: it turns the document model into HTML using
// Word's own compatibility class names (MsoNormalTable etc, verified by
// inspecting real output), which is exactly the technique Word itself
// uses for "Save as Web Page" — Word opens HTML documents natively, and
// browsers print HTML to PDF natively. Both formats below are genuinely
// functional without needing OOXML at all.

const PX_PER_INCH = 96;

function pxToIn(px: number | undefined, fallback: number): string {
  return `${((px ?? fallback) / PX_PER_INCH).toFixed(2)}in`;
}

function getDocTitle(snapshot: IDocumentData): string {
  return snapshot.title?.trim() || "Untitled document";
}

function buildHtmlBody(snapshot: IDocumentData): string {
  return convertBodyToHtml(snapshot);
}

function buildPageCss(snapshot: IDocumentData) {
  const style = snapshot.documentStyle;
  const width = pxToIn(style?.pageSize?.width ?? undefined, 8.27 * PX_PER_INCH);
  const height = pxToIn(style?.pageSize?.height ?? undefined, 11.69 * PX_PER_INCH);
  const marginTop = pxToIn(style?.marginTop, 72);
  const marginBottom = pxToIn(style?.marginBottom, 72);
  const marginLeft = pxToIn(style?.marginLeft, 72);
  const marginRight = pxToIn(style?.marginRight, 72);
  return { width, height, marginTop, marginBottom, marginLeft, marginRight };
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// A plain, portable HTML file — opens in any browser, editable in Word too
// (Word opens .html natively), no MS-specific markup.
export function exportAsHtml(snapshot: IDocumentData) {
  const title = getDocTitle(snapshot);
  const body = buildHtmlBody(snapshot);
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1b1c1f; max-width: 800px; margin: 40px auto; }
  table.UniverTable { border-collapse: collapse; }
  table.UniverTable td.UniverTableCell { border: 1px solid #ccc; padding: 4px 8px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  downloadBlob(html, "text/html", `${title}.html`);
}

// Word-compatible export via the same HTML-with-Office-namespaces
// technique Word itself generates from "Save as Web Page" — Word opens
// this as a real document (not a raw-text fallback). Not true OOXML
// (.docx binary format — that needs Pro), but a legitimate, long-standing
// interop format Word has supported for decades.
export function exportAsWord(snapshot: IDocumentData) {
  const title = getDocTitle(snapshot);
  const body = buildHtmlBody(snapshot);
  const { width, height, marginTop, marginBottom, marginLeft, marginRight } = buildPageCss(snapshot);
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
</w:WordDocument>
</xml>
<![endif]-->
<style>
  @page {
    size: ${width} ${height};
    margin: ${marginTop} ${marginRight} ${marginBottom} ${marginLeft};
  }
  body { font-family: Arial, Helvetica, sans-serif; color: #1b1c1f; }
  table.UniverTable { border-collapse: collapse; }
  table.UniverTable td.UniverTableCell { border: 1px solid #999; padding: 4px 8px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  downloadBlob(html, "application/msword", `${title}.doc`);
}

// PDF via the browser's own print pipeline — a hidden iframe (not
// window.open) avoids popup-blocker issues entirely, since nothing new
// opens; the user picks "Save as PDF" in their browser's native print
// dialog, which every major browser supports without any library.
export function exportAsPdf(snapshot: IDocumentData) {
  const title = getDocTitle(snapshot);
  const body = buildHtmlBody(snapshot);
  const { width, height, marginTop, marginBottom, marginLeft, marginRight } = buildPageCss(snapshot);
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: ${width} ${height};
    margin: ${marginTop} ${marginRight} ${marginBottom} ${marginLeft};
  }
  body { font-family: Arial, Helvetica, sans-serif; color: #1b1c1f; margin: 0; }
  table.UniverTable { border-collapse: collapse; }
  table.UniverTable td.UniverTableCell { border: 1px solid #999; padding: 4px 8px; }
</style>
</head>
<body>
${body}
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const cleanup = () => {
    // Give the print dialog a moment to actually open before the iframe
    // (and the document it holds) gets torn down from under it.
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };

  const frameWindow = iframe.contentWindow;
  if (!frameWindow) {
    document.body.removeChild(iframe);
    return;
  }
  frameWindow.document.open();
  frameWindow.document.write(html);
  frameWindow.document.close();
  frameWindow.onafterprint = cleanup;
  iframe.onload = () => {
    frameWindow.focus();
    frameWindow.print();
    // onafterprint isn't reliable across all browsers, so also clean up
    // on a fallback timer.
    setTimeout(cleanup, 60000);
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
