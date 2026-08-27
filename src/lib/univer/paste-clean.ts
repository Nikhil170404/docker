/**
 * Cleaning HTML pasted from Word.
 *
 * This is the single loudest complaint about every editor in this category:
 * paste a document from Word and you get lost bullets, dropped text, and a
 * thicket of `mso-` styles and empty spans that survive into whatever you
 * save. TinyMCE charges for the plugin that fixes it. It is fixable.
 *
 * What Word actually puts on the clipboard is an HTML document wrapped in
 * fragment markers, carrying Office-namespaced elements (`<o:p>`, `<w:…>`),
 * conditional comments, a stylesheet full of `mso-` declarations, and lists
 * that are not lists at all — they are paragraphs with a literal bullet
 * character and an `mso-list` style. Every one of those needs different
 * treatment, and getting them wrong is what makes pasted content look
 * subtly broken.
 *
 * The approach is an allow-list, not a block-list. Anything not explicitly
 * permitted is unwrapped or dropped, which handles the Word artefacts we
 * know about *and* the ones we do not — including the ones that would be a
 * security problem, since pasted HTML is entirely untrusted input.
 */

/** Elements that carry meaning worth keeping. Everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
  "p", "br", "div",
  "b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "mark",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "a", "img",
  "blockquote", "pre", "code", "hr", "span",
]);

/** Dropped entirely, contents and all. */
const DISCARDED_TAGS = new Set([
  "script", "style", "meta", "link", "head", "title", "noscript",
  "object", "embed", "iframe", "form", "input", "button", "select", "textarea",
  "xml",
]);

/** Attributes worth keeping, per element. */
const GLOBAL_ATTRIBUTES = new Set(["style", "colspan", "rowspan", "dir"]);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "width", "height"]),
};

/**
 * CSS declarations worth keeping. Word emits dozens per element, almost all
 * of them either `mso-` private or a restatement of a default.
 */
const ALLOWED_STYLES = new Set([
  "font-weight", "font-style", "font-size", "font-family",
  "color", "background-color",
  "text-align", "text-decoration", "text-indent",
  "vertical-align",
  "margin-left", "padding-left",
]);

/** Fragment markers Word wraps the actual selection in. */
const FRAGMENT_START = "<!--StartFragment-->";
const FRAGMENT_END = "<!--EndFragment-->";

export interface CleanResult {
  html: string;
  /** What was removed, for the "we cleaned this up" affordance. */
  removed: {
    msoStyles: number;
    officeElements: number;
    emptyElements: number;
    listsConverted: number;
    unsafeElements: number;
  };
}

/* ------------------------------------------------------------------ */
/* Text-level passes, before parsing                                   */
/* ------------------------------------------------------------------ */

/**
 * Word wraps the copied selection in fragment markers and surrounds it with
 * a whole HTML document. Only the fragment was actually selected.
 */
function extractFragment(html: string): string {
  const start = html.indexOf(FRAGMENT_START);
  const end = html.indexOf(FRAGMENT_END);
  if (start === -1 || end === -1 || end < start) return html;
  return html.slice(start + FRAGMENT_START.length, end);
}

/**
 * Conditional comments, of which Word emits two kinds that need opposite
 * treatment.
 *
 * Downlevel-*hidden* (`<!--[if …]> … <![endif]-->`) is a real comment: the
 * content is alternative markup for old Word versions and goes entirely.
 *
 * Downlevel-*revealed* (`<![if …]> … <![endif]>`) is not a comment to a
 * browser at all — the content between the markers is meant to render, and
 * for a list it *is* the bullet or number. Deleting the whole block here
 * would throw that marker away before the list converter can read it, which
 * is how a numbered list silently becomes a bulleted one. So only the
 * markers go; the content stays and `stripListMarker` deals with it.
 */
function stripConditionals(html: string): string {
  return html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!\[if[^\]]*\]>/gi, "")
    .replace(/<!\[endif\]>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/* ------------------------------------------------------------------ */
/* Word lists                                                          */
/* ------------------------------------------------------------------ */

/** A Word "list item" is a paragraph carrying an mso-list style. */
function wordListLevel(el: Element): number | null {
  const style = el.getAttribute("style") ?? "";
  const match = /mso-list\s*:\s*[^;]*?level(\d+)/i.exec(style);
  if (match) return Number(match[1]);
  // Word also marks continuation paragraphs by class alone.
  return /MsoListParagraph/i.test(el.getAttribute("class") ?? "") ? 1 : null;
}

/** Ordered when the marker is a number or letter followed by . or ) */
function isOrderedMarker(text: string): boolean {
  return /^\s*(\d+|[a-z]|[ivxlcdm]+)\s*[.)]/i.test(text);
}

/**
 * The bullet or number Word rendered, which must not survive into the text:
 * a real list draws its own marker, so leaving Word's would double it.
 */
function stripListMarker(el: Element): string {
  let marker = "";
  for (const span of Array.from(el.querySelectorAll("span"))) {
    const style = span.getAttribute("style") ?? "";
    if (/mso-list\s*:\s*Ignore/i.test(style)) {
      marker = span.textContent ?? "";
      span.remove();
    }
  }
  return marker;
}

/**
 * Turns runs of Word list paragraphs into real `<ul>`/`<ol>` trees.
 *
 * Word does not nest lists; it emits a flat sequence of paragraphs each
 * carrying its own level. Rebuilding the nesting from those levels is the
 * whole job, and it is why pasted lists lose their structure everywhere
 * this is not done.
 */
function convertWordLists(root: Element, doc: Document): number {
  const children = Array.from(root.children);
  let converted = 0;
  let index = 0;

  while (index < children.length) {
    const level = wordListLevel(children[index]);
    if (level === null) {
      index++;
      continue;
    }

    // Collect the whole consecutive run of list paragraphs.
    const run: { el: Element; level: number }[] = [];
    while (index < children.length) {
      const itemLevel = wordListLevel(children[index]);
      if (itemLevel === null) break;
      run.push({ el: children[index], level: itemLevel });
      index++;
    }

    const marker = stripListMarker(run[0].el);
    const listTag = isOrderedMarker(marker) ? "ol" : "ul";

    const rootList = doc.createElement(listTag);
    run[0].el.replaceWith(rootList);

    // A stack of open lists, one per depth currently being built.
    const stack: Element[] = [rootList];

    for (const { el, level } of run) {
      stripListMarker(el);

      while (stack.length < level) {
        const nested = doc.createElement(listTag);
        const parentItems = stack[stack.length - 1].children;
        const lastItem = parentItems[parentItems.length - 1];
        // A nested list belongs inside the item above it; with no item to
        // attach to, Word has given us a level jump and the list itself is
        // the only sane parent.
        (lastItem ?? stack[stack.length - 1]).appendChild(nested);
        stack.push(nested);
      }
      while (stack.length > level) stack.pop();

      const item = doc.createElement("li");
      while (el.firstChild) item.appendChild(el.firstChild);
      stack[stack.length - 1].appendChild(item);
      if (el !== run[0].el) el.remove();
      converted++;
    }
  }

  return converted;
}

/* ------------------------------------------------------------------ */
/* Element and attribute cleaning                                      */
/* ------------------------------------------------------------------ */

function cleanStyle(value: string, counters: CleanResult["removed"]): string {
  const kept: string[] = [];

  for (const declaration of value.split(";")) {
    const [rawProperty, ...rest] = declaration.split(":");
    if (rest.length === 0) continue;

    const property = rawProperty.trim().toLowerCase();
    const propertyValue = rest.join(":").trim();
    if (!property || !propertyValue) continue;

    if (property.startsWith("mso-")) {
      counters.msoStyles++;
      continue;
    }
    if (!ALLOWED_STYLES.has(property)) continue;
    // Word writes `font-weight: normal` on everything; keeping it would
    // override a real bold inherited from an ancestor.
    if (propertyValue === "normal" || propertyValue === "none") continue;
    // url() in a pasted style is a request to an attacker's server.
    if (/url\s*\(/i.test(propertyValue)) continue;

    kept.push(`${property}: ${propertyValue}`);
  }

  return kept.join("; ");
}

const SAFE_URL = /^(https?:|mailto:|tel:|data:image\/(png|jpe?g|gif|webp);base64,)/i;

function cleanAttributes(el: Element, counters: CleanResult["removed"]): void {
  const tag = el.tagName.toLowerCase();
  const allowed = TAG_ATTRIBUTES[tag];

  for (const attribute of Array.from(el.attributes)) {
    const name = attribute.name.toLowerCase();

    // Every on* handler is executable code arriving from a clipboard.
    if (name.startsWith("on")) {
      counters.unsafeElements++;
      el.removeAttribute(attribute.name);
      continue;
    }

    if (name === "style") {
      const cleaned = cleanStyle(attribute.value, counters);
      if (cleaned) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
      continue;
    }

    if ((name === "href" || name === "src") && !SAFE_URL.test(attribute.value.trim())) {
      // javascript:, vbscript:, and anything else exotic.
      counters.unsafeElements++;
      el.removeAttribute(attribute.name);
      continue;
    }

    if (!GLOBAL_ATTRIBUTES.has(name) && !allowed?.has(name)) {
      el.removeAttribute(attribute.name);
    }
  }
}

/** Replaces an element with its children, keeping the text. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

const VOID_TAGS = new Set(["br", "img", "hr"]);

function cleanTree(root: Element, counters: CleanResult["removed"]): void {
  // Snapshot first: the walk mutates the tree underneath itself.
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (!el.isConnected) continue;

    const tag = el.tagName.toLowerCase();

    if (DISCARDED_TAGS.has(tag)) {
      if (tag === "script" || tag === "iframe" || tag === "object" || tag === "embed") {
        counters.unsafeElements++;
      }
      el.remove();
      continue;
    }

    // Office namespaces: <o:p>, <w:sdt>, <v:shape>, <m:oMath>.
    if (tag.includes(":")) {
      counters.officeElements++;
      unwrap(el);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el);
      continue;
    }

    cleanAttributes(el, counters);
  }

  // Empty elements, innermost first, repeatedly: removing an empty span can
  // leave its parent empty too.
  let removedThisPass: number;
  do {
    removedThisPass = 0;
    for (const el of Array.from(root.querySelectorAll("*")).reverse()) {
      if (!el.isConnected) continue;
      const tag = el.tagName.toLowerCase();
      if (VOID_TAGS.has(tag) || tag === "td" || tag === "th") continue;

      const text = (el.textContent ?? "").replace(/ /g, " ").trim();
      if (text === "" && el.querySelector("img, br, hr") === null) {
        el.remove();
        counters.emptyElements++;
        removedThisPass++;
      }
    }
  } while (removedThisPass > 0);

  // A span carrying nothing is just noise in the output.
  for (const span of Array.from(root.querySelectorAll("span"))) {
    if (span.attributes.length === 0) unwrap(span);
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** True when the HTML looks like it came from Word or another Office app. */
export function looksLikeWordHtml(html: string): boolean {
  return /(?:mso-|urn:schemas-microsoft-com|class=["']?Mso|<o:p|<!--StartFragment)/i.test(
    html,
  );
}

/**
 * Cleans pasted HTML into something worth putting in a document.
 *
 * Safe to run on any pasted HTML, not only Word's: the allow-list makes it a
 * sanitiser as well as a cleaner, and pasted markup is untrusted by
 * definition.
 */
export function cleanPastedHtml(html: string): CleanResult {
  const counters: CleanResult["removed"] = {
    msoStyles: 0,
    officeElements: 0,
    emptyElements: 0,
    listsConverted: 0,
    unsafeElements: 0,
  };

  if (!html.trim()) return { html: "", removed: counters };

  const prepared = stripConditionals(extractFragment(html));
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body><div id="dockaro-paste-root">${prepared}</div></body></html>`,
    "text/html",
  );

  const root = doc.getElementById("dockaro-paste-root");
  if (!root) return { html: "", removed: counters };

  // Lists first: the conversion reads mso-list styles that the attribute
  // cleaning below is about to delete.
  counters.listsConverted = convertWordLists(root, doc);
  cleanTree(root, counters);

  // Word pads with non-breaking spaces; runs of them are layout, not text.
  const cleaned = root.innerHTML
    .replace(/( |&nbsp;){2,}/g, " ")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

  return { html: cleaned, removed: counters };
}
