// The single HTML+CSS builder both the in-app Paged.js preview and PDF
// export consume, so "preview and PDF use one layout" is structural, not
// just visually similar — there is exactly one place page size/margins are
// defined for fidelity-mode documents.
//
// Dimensions match DEFAULT_DOCUMENT_STYLE in DocsEditor.tsx (A4 at 96dpi:
// 794x1123px, i.e. 8.27in x 11.69in) so a fidelity document looks the same
// size as a Univer one — consistent with the rest of the app, not a Paged.js
// requirement.

export const FIDELITY_PAGE_WIDTH_IN = 8.27;
export const FIDELITY_PAGE_HEIGHT_IN = 11.69;
export const FIDELITY_PAGE_MARGIN_IN = 1;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The @page + base typography rules shared by preview and PDF. Paged.js
 * reads @page itself (it's the whole point of the library); this is NOT
 * the same as relying on a browser's native (partial) @page support. */
export function buildPrintCss(): string {
  return `
    @page {
      size: ${FIDELITY_PAGE_WIDTH_IN}in ${FIDELITY_PAGE_HEIGHT_IN}in;
      margin: ${FIDELITY_PAGE_MARGIN_IN}in;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #1b1c1f;
      font-size: 11pt;
      line-height: 1.4;
    }
    table { border-collapse: collapse; }
    /* Paged.js renders each page as its own .pagedjs_page box, not a
       literal <body> per page — a "body { background }" rule here never
       reaches anything on screen, so the page box itself is targeted
       directly to get the plain white sheet look print preview/PDF need. */
    .pagedjs_page {
      background: #fff;
    }
  `;
}

/** A complete standalone HTML document wrapping the fidelity content —
 * used as the iframe source for PDF export (doc-export.ts's exportAsPdf
 * uses the same "full standalone document into a hidden iframe" shape). */
export function buildPrintableHtml(html: string, title: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${buildPrintCss()}</style>
</head>
<body>
${html}
</body>
</html>`;
}
