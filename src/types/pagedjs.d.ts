// pagedjs ships no TypeScript types. Only the surface this app actually
// uses (Previewer.preview) is declared here — confirmed against
// node_modules/pagedjs/dist/paged.esm.js: `preview(content, stylesheets,
// renderTo)`, where `stylesheets` entries are either a URL string (fetched
// over the network) or a `{ [label]: cssText }` object for inline CSS
// (Polisher.add branches on `typeof arg === "object"` and skips the fetch).
declare module "pagedjs" {
  export interface PagedFlowPage {
    element: HTMLElement;
  }

  export interface PagedFlow {
    pages: PagedFlowPage[];
    total: number;
    performance: number;
  }

  export type PagedStylesheetInput = string | Record<string, string>;

  export class Previewer {
    constructor(options?: Record<string, unknown>);
    preview(
      content?: Node | string,
      stylesheets?: PagedStylesheetInput[],
      renderTo?: HTMLElement,
    ): Promise<PagedFlow>;
  }
}
