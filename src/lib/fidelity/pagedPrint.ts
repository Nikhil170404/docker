import { buildPrintCss } from "./buildPrintableHtml";

// Both the in-app preview and PDF export call this one function to turn
// fidelity-mode HTML into paginated `.pagedjs_page` DOM via Paged.js —
// there is exactly one implementation of "how pagination happens" here,
// which is what keeps preview and PDF from ever being able to drift apart
// from each other, rather than two hand-tuned layouts that happen to look
// similar.
export async function renderPagedContent(html: string, title: string): Promise<HTMLElement> {
  const { Previewer } = await import("pagedjs");

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  document.body.appendChild(container);

  const source = document.createElement("div");
  source.innerHTML = html;

  const previewer = new Previewer();
  await previewer.preview(source, [{ "fidelity-print.css": buildPrintCss() }], container);

  container.setAttribute("data-fidelity-title", title);
  return container;
}

/** Detaches a rendered container from the live document without discarding
 * it — used once its content has been cloned elsewhere (into the preview
 * modal or the print iframe). */
export function releasePagedContent(container: HTMLElement) {
  container.remove();
}

// PDF export: render once via the shared function above, then print that
// exact output through a hidden iframe — the same "invisible iframe +
// window.print()" shape as doc-export.ts's exportAsPdf, including its
// already-fixed double-cleanup guard (a real crash found and fixed earlier
// this session: onafterprint and the fallback timer can both fire for the
// same print, and removeChild on an already-removed node throws).
export async function exportFidelityAsPdf(html: string, title: string): Promise<void> {
  const rendered = await renderPagedContent(html, title);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      // Released here, not right after cloning its HTML below: Paged.js
      // schedules layout-underflow rechecks (Page.checkUnderflowAfterResize,
      // via ResizeObserver) against `rendered` that can still be pending at
      // that point — removing the container before one of those fires
      // leaves it walking a detached node's siblings ("Cannot read
      // properties of null (reading 'nextSibling')"). There's no event for
      // "Paged.js's observers have all settled" to wait on instead, but
      // onafterprint/the fallback timer below both already mean "the user
      // has been looking at a live print dialog for a while" — comfortably
      // longer than any pending observer callback needs, and a real signal
      // rather than a guessed delay tacked on right after rendering.
      releasePagedContent(rendered);
    }, 2000);
  };

  const frameWindow = iframe.contentWindow;
  if (!frameWindow) {
    releasePagedContent(rendered);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    return;
  }

  // Paged.js writes its own generated page-box CSS as <style> elements
  // into the rendered container (alongside the polished @page rules) —
  // carrying the container's full outerHTML across into the iframe brings
  // those along, so the print output matches the on-screen preview
  // without needing to re-run Paged.js's CSS pipeline a second time.
  const pageHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)}</title></head>
<body>${rendered.innerHTML}</body>
</html>`;

  frameWindow.document.open();
  frameWindow.document.write(pageHtml);
  frameWindow.document.close();
  frameWindow.onafterprint = cleanup;
  iframe.onload = () => {
    frameWindow.focus();
    frameWindow.print();
    setTimeout(cleanup, 60000);
  };
}
