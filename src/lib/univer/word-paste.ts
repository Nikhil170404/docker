import type { IDisposable, Injector } from "@univerjs/core";
import { IDocClipboardService } from "@univerjs/docs-ui";
import { cleanPastedHtml, looksLikeWordHtml } from "./paste-clean";

/**
 * Intercepts paste so Word's HTML is cleaned before the editor parses it.
 *
 * The clipboard hook Univer exposes (`onBeforePaste`) runs *after* parsing,
 * which is too late for the damage that matters: by then Word's literal
 * bullet characters are text, its `mso-list` paragraphs are ordinary
 * paragraphs, and the structure is gone. The only place to fix that is the
 * HTML itself, so the listener below takes the paste, cleans it, and hands
 * the result back to Univer's own paste path.
 *
 * Capture phase, so this runs before Univer's own listener; `preventDefault`
 * and `stopPropagation` then keep the original from being pasted as well.
 */
export function installWordPasteCleaner(
  injector: Injector,
  getContainer: () => HTMLElement | null,
): IDisposable {
  const container = getContainer();
  if (!container) {
    return { dispose: () => {} };
  }

  const clipboard = injector.get(IDocClipboardService);

  const onPaste = (event: Event) => {
    const clipboardEvent = event as ClipboardEvent;
    const data = clipboardEvent.clipboardData;
    if (!data) return;

    const html = data.getData("text/html");
    // Nothing to improve on: plain text, or HTML that did not come from an
    // Office application. Leaving those to Univer keeps its own handling of
    // internal copy/paste (which carries a richer payload) intact.
    if (!html || !looksLikeWordHtml(html)) return;

    const { html: cleaned } = cleanPastedHtml(html);
    if (!cleaned) return;

    event.preventDefault();
    event.stopPropagation();

    void clipboard.legacyPaste({
      html: cleaned,
      text: data.getData("text/plain"),
      files: [],
    });
  };

  container.addEventListener("paste", onPaste, true);

  return {
    dispose: () => container.removeEventListener("paste", onPaste, true),
  };
}
