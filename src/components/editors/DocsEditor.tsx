"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverDocsCorePreset } from "@univerjs/preset-docs-core";
import UniverPresetDocsCoreEnUS from "@univerjs/preset-docs-core/locales/en-US";
import { UniverDocsDrawingPreset } from "@univerjs/preset-docs-drawing";
import UniverPresetDocsDrawingEnUS from "@univerjs/preset-docs-drawing/locales/en-US";
import { UniverDocsHyperLinkPreset } from "@univerjs/preset-docs-hyper-link";
import UniverPresetDocsHyperLinkEnUS from "@univerjs/preset-docs-hyper-link/locales/en-US";
import { UniverDocsThreadCommentPreset } from "@univerjs/preset-docs-thread-comment";
import UniverPresetDocsThreadCommentEnUS from "@univerjs/preset-docs-thread-comment/locales/en-US";
import { UniverDocsFindReplacePlugin } from "@univerjs/docs-find-replace";
import { DocumentFlavor, ICommandService, IContextService, UniverInstanceType, validateDocumentStructure } from "@univerjs/core";
import type { DocumentDataModel, IDocumentData, Injector, Nullable } from "@univerjs/core";
import { IUniverInstanceService } from "@univerjs/core";
import { DocSelectionManagerService, DocSkeletonManagerService, SetTextSelectionsOperation } from "@univerjs/docs";
import { IRenderManagerService } from "@univerjs/engine-render";
import {
  ALL_TABLE_STYLE_COMMANDS,
  clearRememberedTableRange,
  resolveLiveTableRange,
  SetTableAlignmentCommandId,
} from "@/lib/univer/table-style-commands";
import { SetBorderPenCommand } from "@/lib/univer/border-pen";
import { loadSnapshot, saveSnapshot, clearSnapshot } from "@/lib/univer/persistence";
import {
  createWordCommands,
  SetIndentCommandId,
  SetPageMarginsCommandId,
  SetZoomCommandId,
} from "@/lib/univer/word-commands";
import WordRuler, { type RulerGeometry } from "./WordRuler";
import WordVerticalRuler from "./WordVerticalRuler";
import { BuiltInUIPart, IUIPartsService } from "@univerjs/ui";
import { installWordRibbon, RELOCATED_UNIVER_MENU_ITEMS, WORD_CURSOR_IN_TABLE_CTX, WORD_UI_LOCALE } from "@/lib/univer/word-ribbon";
import { createTableResizeInteraction } from "@/lib/univer/table-resize";
import { createTableMoveInteraction } from "@/lib/univer/table-move";
import { hidePageMarginMarks } from "@/lib/univer/page-chrome";
import { disableSlashMenu } from "@/lib/univer/slash-key";
import { restoreFocusAfterDialogs } from "@/lib/univer/editor-focus";
import { createWordFeatureCommands } from "@/lib/univer/word-features";
import { createSpellCheckCommand, createSpellChecker } from "@/lib/univer/spell-check";
import { createTrackChanges, createTrackChangesCommands } from "@/lib/univer/track-changes";
import { createWatermarkCommand } from "@/lib/univer/watermark";
import { buildWordLocale, WORD_THEME } from "@/lib/univer/word-theme";

const STORAGE_KEY = "docs-default";

// ─── Word paste utilities (module-level so PasteDialog can call them) ─────────

// Matches Word's clipboard markup (mso-*, xmlns:w=, ProgId=Word, ...) AND
// Google Docs' (every Google Docs copy wraps its whole payload in
// `<b id="docs-internal-guid-...">`, regardless of doc content). Both need
// the same pt-unit and heading-semantics cleanup below before Univer's
// paste handler can lay them out correctly — renamed from the Word-only
// name this started as, since neither the detection nor most of the clean-
// up in cleanWordHtml is actually Word-specific.
const RICH_PASTE_SOURCE_RE = /mso-|xmlns:w=|class="?Mso|ProgId="?Word|Generator.*Microsoft Word|xmlns:o=|id="docs-internal-guid-/i;

const GOOGLE_DOCS_SLICE_MIME = "application/x-vnd.google-docs-document-slice-clip+wrapped";

function extractGoogleDocsBookmarkAnchors(payload: string | null | undefined): string[] {
  if (!payload) return [];
  try {
    const outer = JSON.parse(payload) as { data?: string };
    if (typeof outer.data !== "string") return [];
    const resolved = (JSON.parse(outer.data) as {
      resolved?: {
        dsl_spacers?: string;
        dsl_entitypositionmap?: { bookmark?: unknown[] };
        dsl_entitytypemap?: Record<string, string>;
      };
    }).resolved;
    const spacers = resolved?.dsl_spacers;
    const positions = resolved?.dsl_entitypositionmap?.bookmark;
    const types = resolved?.dsl_entitytypemap;
    if (!spacers || !positions || !types) return [];

    const bookmarkIds = new Set(
      Object.entries(types).filter(([, type]) => type === "bookmark").map(([id]) => id)
    );
    const anchors = new Set<string>();
    positions.forEach((entry, offset) => {
      if (!Array.isArray(entry) || !entry.some((id) => typeof id === "string" && bookmarkIds.has(id))) return;
      const start = spacers.lastIndexOf("\\n", offset) + 1;
      const end = spacers.indexOf("\\n", offset);
      const label = spacers.slice(start, end === -1 ? undefined : end)
        .replace(/[\\x00-\\x1f]/g, "").replace(/\\s+/g, " ").trim();
      if (label) anchors.add(label);
    });
    return [...anchors];
  } catch {
    return [];
  }
}

function addGoogleDocsBookmarkMarkers(doc: Document, anchors: readonly string[]) {
  if (anchors.length === 0) return;
  const remaining = new Set(anchors);
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li"))) {
    const text = (element.textContent ?? "").replace(/\\s+/g, " ").trim();
    if (!remaining.has(text)) continue;
    const marker = doc.createElement("span");
    marker.setAttribute("data-google-docs-bookmark", "true");
    marker.setAttribute("aria-label", "Bookmark");
    marker.textContent = "🔖 ";
    marker.style.cssText = "font-size:10pt; line-height:1; vertical-align:baseline;";
    element.insertBefore(marker, element.firstChild);
    remaining.delete(text);
    if (remaining.size === 0) break;
  }
}


function cleanWordHtml(html: string, mode: "keep" | "clean" = "keep", googleDocsPayload?: string | null): string {
  // Phase 1: Extract class-based styles from <style> block
  const classStyles = new Map<string, string>();
  // A heading (or any element) can also be styled by a bare TAG selector
  // in the <style> block (`h1 { font-size: 16pt; font-weight: bold; ...
  // }`, no class involved) — a legitimate, if less common, way real
  // documents define "Heading 1" alongside the more usual class-based
  // one. Only the class form was ever extracted here, so a tag-selector-
  // styled heading carried no style information into the DOM at all: it
  // rendered completely plain (no bold, no color, no size), not even
  // falling into the "no explicit size, demote to a plain paragraph"
  // path deliberately, since that path still preserves whatever the
  // element itself specifies — there was simply nothing to preserve.
  // Confirmed by pasting a real-shaped `h1 { ... }` rule with no class.
  const tagStyles = new Map<string, string>();
  const styleBlockMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleBlockMatch) {
    const ruleRx = /([^{}]+)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRx.exec(styleBlockMatch[1])) !== null) {
      const props = m[2].split(";").map((p) => p.trim()).filter((p) => p && !/^mso-/i.test(p)).join("; ");
      if (!props) continue;
      for (const selector of m[1].split(",")) {
        const trimmed = selector.trim();
        if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed)) {
          // A bare tag selector (`h1`), nothing else in the token at all.
          tagStyles.set(trimmed.toLowerCase(), props);
          continue;
        }
        // A class reference anywhere in the token — bare (`.MsoNormal`) or
        // compound (`p.MsoNormal`, tag+class together, the far more common
        // real-document form: `p.MsoNormal, li.MsoNormal, div.MsoNormal`).
        // Not anchored to the token's start on purpose, matching this
        // extraction's original (looser, but correct for that form) intent.
        const classMatch = /\.(\w+)/.exec(trimmed);
        if (classMatch) classStyles.set(classMatch[1], props);
      }
    }
  }

  // Phase 0: DOM conversions before mso-* stripping
  let working = html;
  try {
    const p0 = new DOMParser().parseFromString(html, "text/html");

    // ⓪ Google Docs wraps its ENTIRE clipboard payload in
    // `<b style="font-weight:normal;" id="docs-internal-guid-...">` — a
    // pure internal marker, not real formatting intent (every Google Docs
    // copy has one, regardless of content). Confirmed by pasting a real
    // Google Doc: every single span underneath — including ones with their
    // own explicit `font-weight:400` — rendered bold, because Univer's
    // paste handler reads the ancestor <b> TAG semantically and never
    // finds a later signal that clears it (each span's own font-weight
    // does correctly control ITS OWN bold state once this wrapper is
    // gone). Unwrapping this one marker element fixes the whole
    // document's bold state at once instead of touching every span.
    p0.querySelectorAll('b[id^="docs-internal-guid-"]').forEach((b) => {
      const frag = p0.createDocumentFragment();
      while (b.firstChild) frag.appendChild(b.firstChild);
      b.replaceWith(frag);
    });

    // ① MsoHeading → <h1>–<h5>
    p0.querySelectorAll("p").forEach((p) => {
      const m = (p as HTMLElement).className.match(/\bMsoHeading(\d)\b/i);
      if (!m) return;
      const level = Math.min(5, Number(m[1]));
      const h = p0.createElement(`h${level}`);
      [...(p as HTMLElement).attributes].forEach((a) => h.setAttribute(a.name, a.value));
      h.innerHTML = p.innerHTML;
      p.replaceWith(h);
    });

    // ② Word list paragraphs → <ul>/<ol>/<li> (supports multi-level via mso-list:lX levelN)
    (function convertWordLists(doc: Document) {
      const parseMsoList = (el: HTMLElement): { listId: string; level: number } | null => {
        const style = el.getAttribute("style") ?? "";
        const m = style.match(/mso-list:\s*l(\d+)\s+level(\d+)/i);
        if (m) return { listId: m[1], level: Number(m[2]) };
        if (/MsoListParagraph/i.test(el.className)) return { listId: "0", level: 1 };
        return null;
      };
      const isWordListPara = (el: Element): el is HTMLElement =>
        el.tagName === "P" && parseMsoList(el as HTMLElement) !== null;
      const containers = new Set<Element>();
      doc.querySelectorAll("p").forEach((p) => {
        if (isWordListPara(p)) containers.add(p.parentElement ?? doc.body);
      });
      for (const container of containers) {
        const kids = Array.from(container.children);
        let i = 0;
        while (i < kids.length) {
          if (!isWordListPara(kids[i])) { i++; continue; }
          const group: HTMLElement[] = [];
          while (i < kids.length && isWordListPara(kids[i])) { group.push(kids[i] as HTMLElement); i++; }

          // Determine top-level list type from first item's marker
          const firstIgnore = group[0].querySelector<HTMLElement>('[style*="mso-list:Ignore"]');
          const firstMarker = (firstIgnore?.textContent ?? "").replace(/\s/g, "");
          const firstOrdered = /^[0-9]+[.)]|^[a-zA-Z]{1,3}[.)]/.test(firstMarker);

          // Build nested structure: stack[level-1] = current list at that level
          const rootList = doc.createElement(firstOrdered ? "ol" : "ul");
          const listStack: HTMLUListElement[] = [rootList as unknown as HTMLUListElement];

          group.forEach((p) => {
            const info = parseMsoList(p) ?? { listId: "0", level: 1 };
            const level = Math.max(1, info.level);
            p.querySelectorAll('[style*="mso-list:Ignore"]').forEach((s) => s.remove());
            const li = doc.createElement("li");
            li.innerHTML = p.innerHTML;
            const cls = p.getAttribute("class");
            if (cls) li.setAttribute("class", cls);
            const rawStyle = (p.getAttribute("style") ?? "").split(";")
              .filter((s) => s.trim() && !/^mso-|text-indent/i.test(s.trim())).join("; ").trim();
            if (rawStyle) li.setAttribute("style", rawStyle);

            while (listStack.length < level) {
              // Need a deeper list: append to last li of current deepest list
              const parent = listStack[listStack.length - 1];
              const lastLi = parent.lastElementChild ?? parent.appendChild(doc.createElement("li"));
              const nested = doc.createElement("ul") as unknown as HTMLUListElement;
              lastLi.appendChild(nested);
              listStack.push(nested);
            }
            while (listStack.length > level) listStack.pop();
            listStack[listStack.length - 1].appendChild(li);
          });

          group[0].replaceWith(rootList);
          group.slice(1).forEach((el) => el.remove());
        }
      }
    })(p0);

    // ③ <br> inside paragraphs → paragraph splits
    // When a <br> is inside a <span>, siblings after it must be re-wrapped in
    // a clone of that span so formatting (font, bold, color) is preserved.
    // A <br> with nothing but more <br>s/whitespace after it inside the
    // paragraph is a pure TRAILING break, not a real line to split off —
    // Google Docs appends `<br><br>` to the last item of a list to
    // represent blank space after it (confirmed in a real Google Doc's
    // clipboard HTML). Splitting on those created a new EMPTY paragraph
    // per trailing <br>, which — since this all happens inside a <li> —
    // Univer's list layout rendered as its own spurious empty bullet, one
    // per list in the whole document; across a long document with many
    // lists, that pollution alone was enough to multiply the page count
    // several times over. Dropping trailing <br>s instead of splitting on
    // them avoids creating that empty content at all.
    p0.querySelectorAll("p").forEach((p) => {
      const brs = [...p.querySelectorAll("br")];
      if (brs.length === 0) return;
      brs.forEach((br) => {
        const tailRange = p0.createRange();
        tailRange.setStartAfter(br);
        if (p.lastChild) tailRange.setEndAfter(p.lastChild);
        const hasRealContentAfter = (tailRange.cloneContents().textContent ?? "").trim() !== "";
        if (!hasRealContentAfter) {
          br.remove();
          return;
        }
        const newP = p0.createElement("p");
        const cls = p.getAttribute("class"); const sty = p.getAttribute("style");
        if (cls) newP.setAttribute("class", cls);
        if (sty) newP.setAttribute("style", sty);
        // If the <br> is inside a span, wrap trailing siblings in a clone of that span
        const parentSpan = br.parentElement !== p && br.parentElement?.tagName === "SPAN"
          ? br.parentElement : null;
        if (parentSpan) {
          // Move nodes after the br that are inside the span into a new span clone
          const spanClone = parentSpan.cloneNode(false) as HTMLElement;
          let next: ChildNode | null = br.nextSibling;
          while (next) { const tmp = next.nextSibling; spanClone.appendChild(next); next = tmp; }
          br.remove();
          parentSpan.insertAdjacentElement("afterend", spanClone);
          // Now move the span clone and everything after it into newP
          let after: ChildNode | null = spanClone;
          while (after) { const tmp: ChildNode | null = after.nextSibling; newP.appendChild(after); after = tmp; }
        } else {
          let next = br.nextSibling;
          while (next) { const tmp = next.nextSibling; newP.appendChild(next); next = tmp; }
          br.remove();
        }
        p.insertAdjacentElement("afterend", newP);
      });
    });

    // ③.5 <hr> → a bordered empty paragraph. Univer's document model has
    // no native horizontal-rule block, so a bare <hr> (Google Docs emits
    // one for a manually-inserted divider line) is silently dropped by its
    // paste converter — confirmed missing from a real paste despite being
    // present in the source clipboard HTML.
    p0.querySelectorAll("hr").forEach((hr) => {
      const p = p0.createElement("p");
      p.className = "UniverNormal";
      p.style.cssText = "border-bottom: 1px solid #c0c0c0; margin: 6pt 0; height: 0;";
      p.innerHTML = "&nbsp;";
      hr.replaceWith(p);
    });

    // ④ CSS vertical-align super/sub → <sup>/<sub>
    p0.querySelectorAll<HTMLElement>('span[style*="vertical-align"]').forEach((span) => {
      const va = span.style.verticalAlign;
      const tag = va === "super" ? "sup" : va === "sub" ? "sub" : null;
      if (!tag) return;
      const el = p0.createElement(tag);
      [...span.attributes].forEach((a) => el.setAttribute(a.name, a.value));
      el.style.removeProperty("vertical-align");
      el.innerHTML = span.innerHTML;
      span.replaceWith(el);
    });

    // ⑤ Track changes: strip deleted text, unwrap inserted text
    p0.querySelectorAll("del").forEach((el) => el.remove());
    p0.querySelectorAll<HTMLElement>('[class*="MsoDelText"], [class*="msoDel"]').forEach((el) => el.remove());
    p0.querySelectorAll("ins").forEach((ins) => {
      const frag = p0.createDocumentFragment();
      while (ins.firstChild) frag.appendChild(ins.firstChild);
      ins.replaceWith(frag);
    });

    // ⑥ Footnotes/endnotes: extract footnote text and append as a section at bottom.
    // Word HTML places footnote markers as <a href="#_ftn1"> in body text and
    // the actual footnote content in a div[style*="mso-element:footnote-list"].
    const footnoteContainer = p0.querySelector<HTMLElement>('[style*="mso-element:footnote-list"], [style*="mso-element:endnote-list"]');
    if (footnoteContainer) {
      const entries: { num: string; text: string }[] = [];
      footnoteContainer.querySelectorAll<HTMLElement>('[style*="mso-element:footnote"], [style*="mso-element:endnote"]').forEach((fn) => {
        const numEl = fn.querySelector("a[href]") ?? fn.querySelector("sup");
        const num = (numEl?.textContent ?? "").trim() || String(entries.length + 1);
        fn.querySelectorAll("a").forEach((a) => a.remove());
        const text = fn.textContent?.trim() ?? "";
        if (text) entries.push({ num, text });
      });
      footnoteContainer.remove();
      if (entries.length > 0) {
        const hr = p0.createElement("hr");
        p0.body.appendChild(hr);
        const sect = p0.createElement("div");
        sect.style.cssText = "font-size:10pt; margin-top:8pt;";
        entries.forEach(({ num, text }) => {
          const p = p0.createElement("p");
          const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          p.innerHTML = `<sup>${num}</sup>&nbsp;${escaped}`;
          sect.appendChild(p);
        });
        p0.body.appendChild(sect);
      }
    }

    // ⑦ Floating / absolutely-positioned images → inline
    // Word's clipboard HTML wraps floating images in <v:shape> with an
    // <!--[if !vml]--> fallback <img position:absolute>. We keep the img (via
    // the $1 substitution in Phase 2) but must strip the absolute positioning.
    p0.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const pos = img.style.position;
      if (pos === "absolute" || pos === "fixed") {
        img.style.removeProperty("position");
        img.style.removeProperty("left");
        img.style.removeProperty("top");
        img.style.removeProperty("z-index");
        img.style.removeProperty("margin-left");
        img.style.removeProperty("margin-top");
      }
      const fl = img.style.float;
      if (fl === "left" || fl === "right") {
        img.style.removeProperty("float");
        img.style.display = "block";
        img.style.margin = "4pt 0";
      }
      if (!img.style.maxWidth) img.style.maxWidth = "100%";
    });
    // Also handle wrapping <span>/<p> that are position:absolute (image anchors)
    p0.querySelectorAll<HTMLElement>('span[style*="position:absolute"], p[style*="position:absolute"]').forEach((el) => {
      el.style.removeProperty("position");
      el.style.removeProperty("left");
      el.style.removeProperty("top");
    });

    working = p0.body.innerHTML;
  } catch { /* DOMParser unavailable */ }

  // Phase 2: Regex cleanup
  let clean = working
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--\[if\s+vml\b[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--\[if\s*![^\]]*\]>([\s\S]*?)<!\[endif\]-->/gi, "$1")
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--\[if[^\]]*\]-->/gi, "")
    .replace(/<!--\[endif\]-->/gi, "")
    .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, "")
    .replace(/<o:p\s*\/>/gi, "")
    .replace(/<\/?w:[^>]*>/gi, "").replace(/<\/?v:[^>]*>/gi, "").replace(/<\/?m:[^>]*>/gi, "")
    .replace(/(style="[^"]*?)(?:\s*mso-[^:]+:[^;";]+;?)+/gi, "$1")
    .replace(/(style='[^']*?)(?:\s*mso-[^:]+:[^;';]+;?)+/gi, "$1")
    .replace(/\s+xmlns[^=]*="[^"]*"/gi, "")
    .replace(/\s+(?:v|o|w):\w+="[^"]*"/gi, "");

  // Phase 3: DOMParser normalisation
  try {
    const tmpDoc = new DOMParser().parseFromString(clean, "text/html");

    // Bake class-based styles into inline styles
    if (classStyles.size > 0) {
      tmpDoc.querySelectorAll("[class]").forEach((el) => {
        const classes = (el as HTMLElement).className.split(/\s+/);
        const fromClass = classes.filter((c) => classStyles.has(c)).map((c) => classStyles.get(c)!).join("; ");
        if (fromClass) {
          const existing = (el as HTMLElement).style.cssText;
          (el as HTMLElement).style.cssText = fromClass + (existing ? "; " + existing : "");
        }
      });
    }

    // Bake bare-tag-selector styles into inline styles too (h1 { ... },
    // with no class involved — see the extraction comment above).
    if (tagStyles.size > 0) {
      tagStyles.forEach((props, tag) => {
        tmpDoc.querySelectorAll(tag).forEach((el) => {
          const existing = (el as HTMLElement).style.cssText;
          (el as HTMLElement).style.cssText = props + (existing ? "; " + existing : "");
        });
      });
    }

    // Strip remaining mso-* from all inline styles
    tmpDoc.querySelectorAll("*").forEach((el) => {
      const s = (el as HTMLElement).style;
      if (!s?.cssText) return;
      s.cssText = s.cssText.replace(/\s*mso-[^:]+:[^;]+;?\s*/gi, "").trim();
    });

    // Strip <tr> height (prevents TableRowHeightRule.EXACT text clipping)
    tmpDoc.querySelectorAll("tr").forEach((tr) => {
      tr.removeAttribute("height");
      (tr as HTMLElement).style.removeProperty("height");
    });

    // line-height: convert pt → px and % → unitless ratio so Univer parses correctly
    tmpDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const lh = el.style?.lineHeight;
      if (!lh) return;
      if (lh.endsWith("pt")) {
        el.style.lineHeight = `${Math.round(parseFloat(lh) * 1.3333)}px`;
      } else if (lh.endsWith("%")) {
        el.style.lineHeight = (parseFloat(lh) / 100).toFixed(2);
      }
    });

    // letter-spacing: pt → px
    tmpDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const ls = el.style?.letterSpacing;
      if (ls && ls.endsWith("pt")) {
        el.style.letterSpacing = `${(parseFloat(ls) * 1.3333).toFixed(1)}px`;
      }
    });

    // paragraph-level spacing: margin-top/bottom pt → px
    tmpDoc.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, li").forEach((el) => {
      ["marginTop", "marginBottom"].forEach((prop) => {
        const val: string = (el.style as unknown as Record<string, string>)[prop] ?? "";
        if (val.endsWith("pt")) {
          (el.style as unknown as Record<string, string>)[prop] =
            `${Math.round(parseFloat(val) * 1.3333)}px`;
        }
      });
    });

    // text-transform:uppercase → bake uppercase text before stripping styles
    tmpDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (el.style?.textTransform === "uppercase") {
        el.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent) {
            node.textContent = node.textContent.toUpperCase();
          }
        });
        el.style.removeProperty("text-transform");
      }
    });

    // Table width normalisation: 100% table, proportional px cells
    // Width values here can be plain numbers (px/pt-ish, historically
    // treated as px), or a CSS percentage — `width: 100%` is the single
    // most common table width Google Docs emits. parseFloat("100%") is
    // 100, so treating that as a raw pixel count (rather than 100% of the
    // page) rendered a full-width table barely 100px wide — every column
    // just a few characters across, text wrapping one letter per line.
    // Confirmed by pasting a 3-column table with no per-cell widths, only
    // `width: 100%` on the <table>: every cell collapsed to ~40px.
    const PAGE_CONTENT_WIDTH = 660;
    const parseWidthPx = (value: string, referencePx: number): number => {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      if (trimmed.endsWith("%")) {
        const pct = parseFloat(trimmed);
        return Number.isFinite(pct) ? (pct / 100) * referencePx : 0;
      }
      const px = parseFloat(trimmed);
      return Number.isFinite(px) ? px : 0;
    };
    tmpDoc.querySelectorAll("table").forEach((table) => {
      // Remove <colgroup>/<col> — Univer reads col widths first and would
      // override our scaled cell widths computed below.
      table.querySelectorAll("colgroup, col").forEach((el) => el.remove());
      // A table's own declared width and the sum of its cells' own declared
      // widths can disagree — plausible in any document old/edited enough
      // to have had columns and the table itself resized independently at
      // different times (confirmed: a table whose cells summed to 820px
      // while the table itself said 630px rendered the cells at their full
      // undiminished size regardless, since scaling by a totalW smaller
      // than what the cells actually sum to is a no-op — table overflowed
      // the page). The cells' own sum is what actually determines each
      // column's proportion, so it's the one used as the scaling
      // reference whenever it's available, falling back to the table's
      // own width only when no cell declares one at all.
      const rowCellSums = [...table.querySelectorAll("tr")].map((row) =>
        [...row.querySelectorAll("td, th")].reduce(
          (sum, cell) =>
            sum +
            (parseWidthPx((cell as HTMLElement).style.width, PAGE_CONTENT_WIDTH) ||
              parseWidthPx(cell.getAttribute("width") || "", PAGE_CONTENT_WIDTH)),
          0,
        ),
      );
      const bestRowCellSum = Math.max(0, ...rowCellSums);
      const totalW =
        bestRowCellSum ||
        parseWidthPx((table as HTMLElement).style.width, PAGE_CONTENT_WIDTH) ||
        parseWidthPx(table.getAttribute("width") || "", PAGE_CONTENT_WIDTH);
      table.removeAttribute("width");
      (table as HTMLElement).style.removeProperty("width");
      // A table's own declared width was being discarded outright in favor
      // of always stretching to the full page (100%) — correct for a table
      // that spans the page, wrong for one deliberately narrower (a
      // callout/box built from a single shaded cell, say): it pasted at
      // full page width when the source had it noticeably narrower.
      // PAGE_CONTENT_WIDTH is the same 660px reference the cell-width
      // scaling below already assumes a full-width table occupies — a
      // narrower source table now targets a proportionally narrower width
      // instead, and cells scale against that same target so the two never
      // disagree with each other the way they would if only one honored
      // the source width.
      const tableTargetWidth = totalW > 0 ? Math.min(totalW, PAGE_CONTENT_WIDTH) : PAGE_CONTENT_WIDTH;
      (table as HTMLElement).style.setProperty("width", `${tableTargetWidth}px`);
      (table as HTMLElement).style.setProperty("border-collapse", "collapse");
      // A table centered via CSS margin:auto (or the legacy align="center"
      // attribute) — common for a narrower callout box — has no CSS-level
      // effect once Univer parses it into its own document model, since
      // table alignment there is a model property (ITable.align), not
      // something a stray margin on the pasted element could ever satisfy.
      // Tag it with a data attribute the paste-completion step below can
      // find, in source order, to apply the real alignment command after
      // the table actually exists in the document.
      const marginLeft = (table as HTMLElement).style.marginLeft;
      const marginRight = (table as HTMLElement).style.marginRight;
      const isCentered =
        table.getAttribute("align") === "center" ||
        (marginLeft === "auto" && marginRight === "auto");
      if (isCentered) (table as HTMLElement).setAttribute("data-align", "center");
      // Word marks a borderless table with the legacy border="0" attribute;
      // Google Docs (used for layout — a letterhead's logo/title/logo row,
      // for instance) instead sets CSS `border: none` on the table and/or
      // each cell. Only checking the old attribute left every Google-Docs
      // layout table showing full black gridlines it never had (confirmed:
      // a 3-column logo/title/logo header pasted with visible borders
      // around each cell despite explicit `border: none` in the source).
      const hasNoBorder = (el: HTMLElement) => /\bnone\b/i.test(el.style.border || el.style.borderStyle || "");
      // Word marks merged-cell "phantom" placeholders with display:none — remove them
      // first, so a phantom cell never counts toward the "every cell says
      // border:none" check below, nor gets processed by the loop after it.
      table.querySelectorAll<HTMLElement>("td[style*='display:none'], td[style*='display: none']").forEach((td) => td.remove());
      const cells = [...table.querySelectorAll("td, th")] as HTMLElement[];
      const isBorderless =
        table.getAttribute("border") === "0" ||
        hasNoBorder(table) ||
        (cells.length > 0 && cells.every(hasNoBorder));
      cells.forEach((cell) => {
        const cellW =
          parseWidthPx(cell.style.width, tableTargetWidth) ||
          parseWidthPx(cell.getAttribute("width") || "", tableTargetWidth);
        cell.removeAttribute("width");
        cell.style.removeProperty("width");
        if (totalW > 0 && cellW > 0) {
          const scaledPx = Math.round((cellW / totalW) * tableTargetWidth);
          cell.style.setProperty("width", `${scaledPx}px`);
          cell.setAttribute("width", String(scaledPx));
        }
        if (isBorderless && !cell.style.borderTop) {
          cell.style.setProperty("border-top",    "0px solid #000000");
          cell.style.setProperty("border-right",  "0px solid #000000");
          cell.style.setProperty("border-bottom", "0px solid #000000");
          cell.style.setProperty("border-left",   "0px solid #000000");
        }
        // Ensure cells always have a block child (Univer skips empty cells)
        const hasBlock = cell.querySelector("p, div, h1, h2, h3, h4, h5, h6, ul, ol, pre, table");
        if (!hasBlock) {
          const ph = tmpDoc.createElement("p");
          ph.className = "UniverNormal";
          ph.innerHTML = cell.innerHTML.trim() || "&nbsp;";
          cell.innerHTML = "";
          cell.appendChild(ph);
        }
      });
    });

    // Univer lays inline images out from their paragraph style rather than
    // CSS auto-margins or a wrapper div's alignment. Promote clipboard
    // alignment onto the nearest paragraph before importing so the logo and
    // illustrations remain centred (or side-aligned) like the source.
    tmpDoc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      const wrapper = img.closest<HTMLElement>("[style*='text-align']");
      const wrapperAlign = wrapper?.style.textAlign;
      const leftAuto = img.style.marginLeft === "auto";
      const rightAuto = img.style.marginRight === "auto";
      const alignment = wrapperAlign === "center" || (leftAuto && rightAuto)
        ? "center"
        : wrapperAlign === "right" || leftAuto
          ? "right"
          : wrapperAlign === "left" || rightAuto
            ? "left"
            : null;
      if (!alignment) return;
      const paragraph = img.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6");
      if (paragraph) paragraph.style.textAlign = alignment;
      img.style.removeProperty("margin-left");
      img.style.removeProperty("margin-right");
    });

    // Headings: preserve heading semantics via data-heading attribute so
    // Univer's getHeadingNamedStyleType fires, while also adding UniverNormal
    // for paragraph style resolution (text-align, line-height, spacing).
    //
    // Univer's own paste parser recognizes a literal <h1>-<h5> TAG on its
    // own (getHeadingNamedStyleType switches on node.tagName directly) and
    // applies its own much larger default size for that heading level
    // whenever the heading's own content doesn't specify a font-size —
    // confirmed by pasting a real-shaped <h1> with no inline font-size on
    // its span: it rendered noticeably larger than a real document's
    // actual (often comparatively modest, e.g. a legal document's section
    // heading) intended size, wrapping and even hyphenating where the
    // source fit on one line. A heading WITH its own explicit font-size
    // keeps that size regardless of tag, so only the sizeless case is a
    // problem. Since there's no way to know what size was actually
    // intended here, the safe choice is not to guess a number of our own
    // either — demoting the tag to a plain paragraph (keeping whatever
    // inline styling, typically just bold, the source did specify) means
    // it inherits the document's normal text size instead of either
    // Univer's oversized default or an invented one.
    tmpDoc.querySelectorAll("h1, h2, h3, h4, h5").forEach((h) => {
      const hasExplicitSize = !!h.querySelector<HTMLElement>('[style*="font-size"]') || /font-size/.test((h as HTMLElement).style.cssText);
      if (!hasExplicitSize) {
        const p = tmpDoc.createElement("p");
        [...h.attributes].forEach((a) => p.setAttribute(a.name, a.value));
        p.innerHTML = h.innerHTML;
        h.replaceWith(p);
        p.className = (p.className + " UniverNormal").trim();
        return;
      }
      const level = h.tagName.toLowerCase();
      (h as HTMLElement).setAttribute("data-heading", level);
      (h as HTMLElement).className = ((h as HTMLElement).className + " UniverNormal").trim();
    });

    // UniverNormal triggers getParagraphStyle() for text-align, line-height, margins
    tmpDoc.querySelectorAll("p").forEach((p) => {
      (p as HTMLElement).className = ((p as HTMLElement).className + " UniverNormal").trim();
    });

    // 'clean' mode: strip font-family/size/color so document styles apply
    if (mode === "clean") {
      tmpDoc.querySelectorAll("*").forEach((el) => {
        const s = (el as HTMLElement).style;
        if (!s?.cssText) return;
        ["font-family", "font-size", "color", "background-color", "background"].forEach((p) => s.removeProperty(p));
      });
    }

    clean = tmpDoc.body.innerHTML;
  } catch { /* DOMParser unavailable */ }
  return clean;
}

// Reads the data-align="center" markers cleanWordHtml leaves on tables, in
// source document order — the same order the tables that land in the
// document (newly-created table IDs, diffed before/after the paste) come
// out in, letting the paste-completion step zip the two together.
function extractTableAlignFlags(html: string): ("start" | "center")[] {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll("table")].map((table) =>
      table.getAttribute("data-align") === "center" ? "center" : "start",
    );
  } catch {
    return [];
  }
}

// ─── Paste-from-Word dialog ────────────────────────────────────────────────────

function PasteDialog({
  rawHtml,
  plainText,
  editorEl,
  pendingHtmlRef,
  pendingPlainRef,
  pendingTableAlignRef,
  googleDocsPayload,
  onClose,
}: {
  rawHtml: string;
  plainText: string;
  editorEl: Element | null;
  pendingHtmlRef: React.RefObject<string | null>;
  pendingPlainRef: React.RefObject<string | null>;
  pendingTableAlignRef: React.RefObject<("start" | "center")[] | null>;
  googleDocsPayload?: string | null;
  onClose: () => void;
}) {
  const insert = (mode: "keep" | "clean" | "text") => {
    onClose();
    let html: string;
    if (mode === "text") {
      html = "<p class=\"UniverNormal\">" +
        plainText
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .split("\n").filter(Boolean).join("</p><p class=\"UniverNormal\">") +
        "</p>";
      pendingTableAlignRef.current = null;
    } else {
      html = cleanWordHtml(rawHtml, mode, googleDocsPayload);
      pendingTableAlignRef.current = extractTableAlignFlags(html);
    }
    pendingHtmlRef.current = html;
    pendingPlainRef.current = plainText;
    const target = editorEl as HTMLElement | null;
    try { target?.focus(); } catch { /* ignore */ }
    const dt = new DataTransfer();
    dt.setData("text/html", "<p>x</p>");
    dt.setData("text/plain", plainText);
    (target ?? document.body).dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
    );
  };

  const btnBase: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left",
    padding: "11px 16px", marginBottom: 8, borderRadius: 7,
    cursor: "pointer", border: "1.5px solid #e2e8f0", background: "#fff",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 10, padding: "28px 32px",
        maxWidth: 400, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        fontFamily: "inherit",
      }}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>
          Paste from Word
        </div>
        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
          How would you like to paste this content?
        </div>
        <button
          onClick={() => insert("keep")}
          style={{ ...btnBase, borderColor: "#2563eb", background: "#eff6ff" }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1d4ed8" }}>Keep Formatting</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Preserve fonts, colors, and table layout</div>
        </button>
        <button
          onClick={() => insert("clean")}
          style={btnBase}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>Match Document Style</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Keep structure, use document fonts</div>
        </button>
        <button
          onClick={() => insert("text")}
          style={btnBase}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>Text Only</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Remove all formatting</div>
        </button>
        <button
          onClick={onClose}
          style={{
            display: "block", width: "100%", textAlign: "center",
            padding: "9px", marginTop: 4, border: "none",
            borderRadius: 7, cursor: "pointer", background: "transparent",
            color: "#64748b", fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
const AUTOSAVE_DELAY_MS = 600;
const DEFAULT_DOCUMENT_NAME = "Untitled document";
const STATUS_REFRESH_DELAY_MS = 400;
// A4 at 96 DPI. Traditional flavor is what unlocks Word-compatible real
// pagination (page breaks, ruler-visible page bounds) and header/footer
// editing — both crash on creation-time documentStyle in Univer 0.25.x but
// work cleanly as of 1.0.0-beta.2.
const DEFAULT_DOCUMENT_STYLE = {
  pageSize: { width: 794, height: 1123 },
  documentFlavor: DocumentFlavor.TRADITIONAL,
};

import "@univerjs/preset-docs-core/lib/index.css";
import "@univerjs/preset-docs-drawing/lib/index.css";
import "@univerjs/preset-docs-hyper-link/lib/index.css";
import "@univerjs/preset-docs-thread-comment/lib/index.css";

/** What the Word-style title bar and status bar display. */
export type WordDocumentStatus = {
  name: string;
  wordCount: number;
  pageCount: number;
  currentPage: number;
  zoom: number;
};

/**
 * What the surrounding Word chrome can do to the document. Everything else
 * — formatting, layout, export — is a ribbon command inside Univer.
 */
export type DocsEditorHandle = {
  setName: (name: string) => void;
  setZoom: (zoom: number) => void;
  /** Live page geometry for the ruler, or null before the doc renders. */
  getRulerGeometry: () => RulerGeometry | null;
  setIndents: (indents: { indentStart?: number; indentEnd?: number; indentFirstLine?: number }) => void;
  setMargins: (margins: { marginLeft?: number; marginRight?: number }) => void;
};

export default function DocsEditor({
  apiRef,
  onStatusChange,
}: {
  apiRef?: React.RefObject<DocsEditorHandle | null>;
  onStatusChange?: (status: WordDocumentStatus) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const disposedRef = useRef(false);
  const commandServiceRef = useRef<ICommandService | null>(null);
  const rulerGeometryRef = useRef<() => RulerGeometry | null>(() => null);
  const documentNameRef = useRef<(name: string) => void>(() => {});
  const statusListenerRef = useRef(onStatusChange);
  const [ready, setReady] = useState(false);
  const pendingHtmlRef = useRef<string | null>(null);
  const pendingPlainRef = useRef<string | null>(null);
  const pendingTableAlignRef = useRef<("start" | "center")[] | null>(null);
  const [pasteDialog, setPasteDialog] = useState<{
    rawHtml: string;
    plainText: string;
    googleDocsPayload?: string | null;
    editorEl: Element | null;
  } | null>(null);

  // The editor is created once; the callback identity may change on every
  // parent render, so it is read through a ref rather than re-running setup.
  useEffect(() => {
    statusListenerRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!containerRef.current || disposedRef.current) return;
    disposedRef.current = true;

    // Word types "/" as a character; Univer's block menu steals the key.
    disableSlashMenu();

    // Univer's own popup-positioning pipeline (@univerjs/ui, shared by
    // every dropdown/context-menu/floating-toolbar it renders — the ribbon
    // dropdowns, the paragraph "quick action" popup, table context menus,
    // all of it) destructures `{ bottom, left, right, top }` from an
    // `anchorRect` it expects its anchor observable to always emit. Hit
    // once in real use ("Cannot destructure property 'bottom' of
    // 'anchorRect' as it is undefined") but never reproduced despite
    // extensive attempts — synthetic paste, real Cmd+V paste, ribbon
    // dropdowns, scrolling, clicking through pasted content — so the exact
    // anchor-element-disappears-mid-positioning race is still unknown, and
    // it's deep inside vendored Univer code we don't control or want to
    // patch directly. Since this is a popup failing to position (not a
    // document-data error), losing that one popup and continuing is far
    // better than Next's dev overlay taking over the whole page; anything
    // else still surfaces normally.
    //
    // Also covers the "EmptyError" dispose race documented at this
    // component's cleanup below (univer.dispose() completing an RxJS
    // Subject with no elements left in its sequence). That race is real
    // and was already guarded there, but with the wrong tool: a real
    // unmount-with-a-table-present test showed it landing as an uncaught
    // *window `error` event*, not the `unhandledrejection` the cleanup's
    // own guard listens for. RxJS's internal errorContext() wrapper
    // deliberately defers a Subject subscriber's synchronous error to a
    // fresh task specifically so ordinary try/catch around .complete()
    // can't see it, then dispatches it as a raw global error — which is
    // exactly what this listener, unlike that one, actually catches.
    // "Table is not found." — thrown by Univer's own spanEntireRow/
    // spanEntireColumn getters (docs-ui) when a selection's own tableId no
    // longer resolves in tableSource, e.g. a rectRange left over from a
    // prior selection state after the table it pointed at was replaced or
    // removed. Reported crashing Select All / Backspace in real use; not
    // reproduced despite many attempts (typing then Cmd+A inside a cell,
    // Cmd+A immediately after table creation, pasting multiple tables then
    // Cmd+A+Backspace) with or without a deep window-level listener to
    // catch a deferred throw. Same class as the two errors above — a
    // stale-selection read, not a document-data corruption — so the same
    // mitigation applies: suppress the crash so the editor keeps working
    // instead of Next's overlay taking over, even without the exact
    // trigger pinned down.
    const suppressKnownBenignUniverErrors = (event: ErrorEvent) => {
      if (event.error instanceof TypeError && /anchorRect/.test(event.message)) event.preventDefault();
      if (event.error?.name === "EmptyError") event.preventDefault();
      if (event.error instanceof Error && event.error.message === "Table is not found.") event.preventDefault();
    };
    window.addEventListener("error", suppressKnownBenignUniverErrors);

    const { univer, univerAPI } = createUniver({
      theme: WORD_THEME,
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: buildWordLocale(
          mergeLocales(
            UniverPresetDocsCoreEnUS,
            UniverPresetDocsDrawingEnUS,
            UniverPresetDocsHyperLinkEnUS,
            UniverPresetDocsThreadCommentEnUS,
          ),
          WORD_UI_LOCALE,
        ),
      },
      presets: [
        UniverDocsCorePreset({
          container: containerRef.current,
          // Word's ribbon: a tab strip over grouped, two-row controls.
          ribbonType: "grid",
          // Univer's own footer is replaced by a Word status bar that also
          // reports the page count.
          footer: false,
          menu: RELOCATED_UNIVER_MENU_ITEMS,
        }),
        UniverDocsDrawingPreset(),
        UniverDocsHyperLinkPreset(),
        UniverDocsThreadCommentPreset(),
      ],
      plugins: [UniverDocsFindReplacePlugin],
    });

    // Docs saved before the 1.0.0-beta.2 upgrade won't have a documentStyle
    // (it used to crash at creation time in 0.25.x — see git history), so
    // they'd silently lose pagination/header-footer on load. Backfill it
    // for any saved doc that predates this, without touching its content.
    let saved = loadSnapshot<Partial<IDocumentData>>(STORAGE_KEY);

    // 1.0.0-beta.2 added a strict structural-integrity check that now runs
    // on every edit (table start/end tokens, section IDs, etc.) and throws
    // if violated — Univer 0.25.x never validated this, so a doc edited
    // under the old version (in particular through our own dataStream-
    // editing MergeTableCellsCommand) can carry corruption that only
    // surfaces now, crashing on the very first edit after load. Check
    // before handing anything to createDocument(): a corrupt snapshot is
    // backed up under its own key (nothing is silently destroyed) and the
    // editor falls back to a fresh document instead of hard-crashing.
    if (saved?.body) {
      const issues = validateDocumentStructure(saved as Pick<IDocumentData, "body" | "headers" | "footers">);
      if (issues.length > 0) {
        console.warn("[DocKaro] Saved document failed structure validation, starting fresh:", issues);
        saveSnapshot(`${STORAGE_KEY}.corrupted.${Date.now()}`, saved);
        clearSnapshot(STORAGE_KEY);
        saved = null;
      }
    }

    const initialData: Partial<IDocumentData> = saved
      ? { ...saved, documentStyle: { ...DEFAULT_DOCUMENT_STYLE, ...saved.documentStyle } }
      : { documentStyle: DEFAULT_DOCUMENT_STYLE };
    // Word names a new document rather than leaving it blank, and this name
    // is what the title bar shows and what the export is filed under.
    if (!initialData.title) initialData.title = DEFAULT_DOCUMENT_NAME;
    const fDoc = univerAPI.createDocument(initialData);

    const injector = univer.__getInjector() as Injector;
    const commandService = injector.get(ICommandService);
    const spellChecker = createSpellChecker(injector, fDoc, () => containerRef.current);
    const trackChanges = createTrackChanges(injector, fDoc);
    const registrations = [
      SetBorderPenCommand,
      ...ALL_TABLE_STYLE_COMMANDS,
      ...createWordCommands({ doc: fDoc, getContainer: () => containerRef.current }),
      ...createWordFeatureCommands(fDoc),
      createSpellCheckCommand(spellChecker),
      ...createTrackChangesCommands(trackChanges),
      createWatermarkCommand(fDoc),
    ].map((command) => commandService.registerCommand(command));
    commandServiceRef.current = commandService;
    documentNameRef.current = (name: string) => {
      fDoc.setName(name);
      saveSnapshot(STORAGE_KEY, fDoc.save());
      void refreshStatus();
    };

    const wordRibbon = installWordRibbon(injector);
    const contextService = injector.get(IContextService);

    // Word puts its ruler between the ribbon and the page. Univer renders a
    // header slot in exactly that spot, so the ruler goes in as a UI part
    // rather than a sibling element that would sit above the ribbon.
    function DocumentRuler() {
      return (
        <WordRuler
          getGeometry={() => rulerGeometryRef.current()}
          handlers={{
            onIndentChange: (indents) => void commandService.executeCommand(SetIndentCommandId, indents),
            onMarginChange: (margins) => void commandService.executeCommand(SetPageMarginsCommandId, margins),
          }}
        />
      );
    }
    const rulerPart = injector.get(IUIPartsService).registerComponent(BuiltInUIPart.HEADER, () => DocumentRuler);

    // The ruler needs the page's on-screen position, which is the document
    // component's own offset inside the scene, shifted by the horizontal
    // scroll and multiplied by the zoom.
    //
    // This originally always used `documents.top` as-is (page 1's own
    // origin), so both rulers only ever showed page 1's geometry — as
    // soon as a real multi-page document was scrolled past roughly one
    // page's height, `pageTop` (page 1's now-scrolled-off-screen position)
    // put every tick off the top of the viewport, and the vertical ruler
    // went blank instead of following the page actually in view.
    // Univer stacks pages vertically at `pageIndex * (pageHeight +
    // pageGap)` from that same origin (confirmed by reading
    // DocumentSkeletonManagerService's own layout math and its
    // `pageMarginTop` config, which defaults to 14 document px when
    // unset, as it is here) — recomputing pageTop for whichever page the
    // current scroll position falls into keeps the ruler correct on every
    // page, not just the first.
    const PAGE_GAP = 14;
    rulerGeometryRef.current = () => {
      const container = containerRef.current;
      const renderUnit = renderManagerService.getRenderUnitById(fDoc.getId());
      const canvas = container?.querySelector("canvas");
      if (!container || !renderUnit || !canvas) return null;

      const documents = renderUnit.mainComponent as unknown as { left: number; top: number } | undefined;
      const scene = renderUnit.scene;
      const scale = scene.getAncestorScale().scaleX || 1;
      const scrollX = scene.getViewport("viewMain")?.viewportScrollX ?? 0;
      const canvasOffset = canvas.getBoundingClientRect().left - container.getBoundingClientRect().left;

      const docModel = univerInstanceService.getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC);
      const style = docModel?.getDocumentStyle();
      if (!documents || !style?.pageSize?.width) return null;

      const paragraphStyle = currentParagraphStyle(docModel);
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollY = scene.getViewport("viewMain")?.viewportScrollY ?? 0;
      const pageHeightDoc = style.pageSize.height ?? 1123;
      const pageStride = pageHeightDoc + PAGE_GAP;
      const pageIndex = Math.max(0, Math.floor((scrollY - documents.top) / pageStride));
      const currentPageTop = documents.top + pageIndex * pageStride;
      return {
        pageLeft: canvasOffset + (documents.left - scrollX) * scale,
        pageTop: canvasRect.top - containerRect.top + (currentPageTop - scrollY) * scale,
        pageWidth: style.pageSize.width * scale,
        pageHeight: pageHeightDoc * scale,
        marginLeft: style.marginLeft ?? 72,
        marginRight: style.marginRight ?? 72,
        marginTop: style.marginTop ?? 72,
        marginBottom: style.marginBottom ?? 72,
        indentStart: paragraphStyle?.indentStart?.v ?? 0,
        indentEnd: paragraphStyle?.indentEnd?.v ?? 0,
        indentFirstLine: paragraphStyle?.indentFirstLine?.v ?? 0,
        scale,
      };
    };
    // Word's table borders are draggable; Univer's have no such interaction.
    const tableResize = createTableResizeInteraction(injector, fDoc.getId(), () => containerRef.current);
    // Word shows a move handle at the top-left corner of a hovered table.
    const tableMove = createTableMoveInteraction(injector, fDoc.getId(), () => containerRef.current);

    // Word paste interception:
    // 1. Capture-phase listener shows the paste dialog for Word HTML.
    // 2. DataTransfer patch returns pendingHtmlRef content for synthetic paste
    //    dispatched by the dialog, and falls back to silent clean otherwise.
    const originalGetData = DataTransfer.prototype.getData;
    DataTransfer.prototype.getData = function (type: string): string {
      if (type === "text/html" && pendingHtmlRef.current !== null) {
        const h = pendingHtmlRef.current; pendingHtmlRef.current = null; return h;
      }
      if (type === "text/plain" && pendingPlainRef.current !== null) {
        const t = pendingPlainRef.current; pendingPlainRef.current = null; return t;
      }
      const data = originalGetData.call(this, type) as string;
      // Fallback: clean silently if Word HTML bypasses the capture listener
      if (type === "text/html" && RICH_PASTE_SOURCE_RE.test(data)) return cleanWordHtml(data, "keep", originalGetData.call(this, GOOGLE_DOCS_SLICE_MIME));
      return data;
    };

    const handleWordPasteCapture = (e: ClipboardEvent) => {
      const html = originalGetData.call(e.clipboardData, "text/html") as string;
      if (!html || !RICH_PASTE_SOURCE_RE.test(html)) return;
      e.preventDefault();
      e.stopPropagation();
      const plain = originalGetData.call(e.clipboardData, "text/plain") as string;
      const googleDocsPayload = originalGetData.call(e.clipboardData, GOOGLE_DOCS_SLICE_MIME) as string;
      setPasteDialog({ rawHtml: html, plainText: plain, googleDocsPayload, editorEl: document.activeElement });
    };
    document.addEventListener("paste", handleWordPasteCapture, true);

    // Applies table centering after a paste actually lands, since Univer's
    // paste-import has no HTML-CSS-to-document mapping for it at all
    // (confirmed by reading every use of TableAlignmentType in docs-ui —
    // the only one is Insert Table's own default) — a pasted centered
    // table would otherwise sit flush against the left margin regardless.
    // Registered as a capture-phase listener alongside handleWordPasteCapture
    // above so it also sees PasteDialog's synthetic re-dispatch and can
    // snapshot the table IDs already in the document BEFORE Univer's own
    // (later-phase) paste handling inserts the new ones; diffing against
    // that snapshot after a short delay identifies exactly which tables
    // just arrived, in the same order cleanWordHtml recorded their
    // centering in.
    const handleTableAlignAfterPaste = () => {
      const flags = pendingTableAlignRef.current;
      if (!flags || flags.length === 0) return;
      const beforeIds = new Set(fDoc.getDocumentDataModel()?.getBody()?.tables?.map((t) => t.tableId) ?? []);
      setTimeout(() => {
        const afterTables = fDoc.getDocumentDataModel()?.getBody()?.tables ?? [];
        const newTables = afterTables.filter((t) => !beforeIds.has(t.tableId));
        newTables.forEach((t, i) => {
          if (flags[i] === "center") {
            void commandService.executeCommand(SetTableAlignmentCommandId, { tableId: t.tableId, align: "center" });
          }
        });
        pendingTableAlignRef.current = null;
      }, 300);
    };
    document.addEventListener("paste", handleTableAlignAfterPaste, true);

    // Secondary interception: programmatic clipboard reads
    const originalClipboardRead = navigator.clipboard.read.bind(navigator.clipboard);
    navigator.clipboard.read = async (...args) => {
      const items = await originalClipboardRead(...args);
      const cleaned: ClipboardItem[] = [];
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const html = await blob.text();
          if (RICH_PASTE_SOURCE_RE.test(html)) {
            const parts: Record<string, Blob | Promise<Blob>> = {
              "text/html": new Blob([cleanWordHtml(html, "keep", item.types.includes(GOOGLE_DOCS_SLICE_MIME) ? await (await item.getType(GOOGLE_DOCS_SLICE_MIME)).text() : null)], { type: "text/html" }),
            };
            if (item.types.includes("text/plain")) parts["text/plain"] = item.getType("text/plain");
            cleaned.push(new ClipboardItem(parts));
            continue;
          }
        }
        cleaned.push(item);
      }
      return cleaned;
    };
    const pageChrome = hidePageMarginMarks(injector, fDoc.getId());
    const dialogFocus = restoreFocusAfterDialogs(injector, fDoc.getId());

    const renderManagerService = injector.get(IRenderManagerService);
    const docSelectionManagerService = injector.get(DocSelectionManagerService);
    const univerInstanceService = injector.get(IUniverInstanceService);

    /** The paragraph the cursor is in, whose indents the ruler shows. */
    const currentParagraphStyle = (docModel: Nullable<DocumentDataModel>) => {
      const offset = docSelectionManagerService.getActiveTextRange()?.startOffset;
      if (offset == null) return undefined;
      const paragraphs = docModel?.getBody()?.paragraphs ?? [];
      return paragraphs.find((paragraph) => paragraph.startIndex >= offset)?.paragraphStyle;
    };

    // Word's status bar: which page the cursor is on, how many pages there
    // are, the word count and the zoom level.
    let statusTimeout: ReturnType<typeof setTimeout> | undefined;
    const refreshStatus = async () => {
      const listener = statusListenerRef.current;
      if (!listener) return;
      const docModel = univerInstanceService.getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC);
      if (!docModel) return;

      const skeleton = renderManagerService.getRenderUnitById(fDoc.getId())?.with(DocSkeletonManagerService)?.getSkeleton();
      const pages = skeleton?.getSkeletonData()?.pages ?? [];
      const cursor = docSelectionManagerService.getActiveTextRange()?.startOffset ?? 0;
      const currentIndex = pages.findIndex((page) => cursor >= page.st && cursor <= page.ed);

      let wordCount = 0;
      try {
        wordCount = (await docModel.getStatistics()).words;
      } catch {
        // Statistics are best-effort: an aborted run (fast typing) must not
        // blank out the rest of the status bar.
      }

      listener({
        name: fDoc.getName(),
        wordCount,
        pageCount: Math.max(pages.length, 1),
        currentPage: currentIndex >= 0 ? currentIndex + 1 : 1,
        zoom: Math.round((docModel.zoomRatio || 1) * 100),
      });
    };
    const scheduleStatusRefresh = () => {
      clearTimeout(statusTimeout);
      statusTimeout = setTimeout(() => void refreshStatus(), STATUS_REFRESH_DELAY_MS);
    };

    // Autosave: debounce so a fast typist doesn't hit localStorage on every
    // keystroke, and flush immediately on refresh/close so the last edit
    // isn't lost (React's unmount cleanup never runs on a hard refresh).
    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    const flushSave = () => saveSnapshot(STORAGE_KEY, fDoc.save());
    // Word shows its Table Design tab whenever the cursor is inside a
    // table. The caret's offset against the document's own table ranges is
    // the reliable test: the selection's node path is empty right after a
    // table mutation (a merge, say), and `textSelection$` alone misses
    // pointer-driven moves, so the selection operation Univer's own toolbar
    // items listen to drives this too.
    const isCursorInsideTable = (): boolean | null => {
      const docDataModel = univerInstanceService.getCurrentUnitOfType<DocumentDataModel>(
        UniverInstanceType.UNIVER_DOC,
      );
      if (resolveLiveTableRange(docSelectionManagerService, docDataModel)) return true;
      const offset = docSelectionManagerService.getActiveTextRange()?.startOffset;
      // No selection at all says nothing about where the user is (a table
      // mutation clears it), so the tab keeps whatever state it had.
      if (offset == null) return null;
      const tables = docDataModel?.getBody()?.tables;
      return Boolean(tables?.some((table) => offset > table.startIndex && offset < table.endIndex));
    };
    const refreshTableContext = () => {
      const inside = isCursorInsideTable();
      if (inside !== null) {
        wordRibbon.setTableContextActive(inside);
        contextService.setContextValue(WORD_CURSOR_IN_TABLE_CTX, inside);
      }
    };

    const commandSubscription = commandService.onCommandExecuted((command) => {
      // Using a table tool keeps the tab up even though the mutation clears
      // the cell selection it was applied to; the next selection change
      // decides again, exactly as in Word.
      if (command.id.startsWith("dockaro.command.table-")) wordRibbon.setTableContextActive(true);
      else if (command.id === SetTextSelectionsOperation.id) refreshTableContext();
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(flushSave, AUTOSAVE_DELAY_MS);
      scheduleStatusRefresh();
    });
    window.addEventListener("beforeunload", flushSave);

    const subscription = docSelectionManagerService.textSelection$.subscribe(() => {
      // Reflect the CURRENT selection exactly, like Word's Table Design tab:
      // show it only while the selection is actually inside a table, and
      // drop it the instant it isn't.
      refreshTableContext();
      scheduleStatusRefresh();
    });

    setReady(true);
    void refreshStatus();

    return () => {
      // Registered first and removed last (see below), covering every
      // dispose() call in this cleanup, not just univer.dispose()'s own.
      // Originally this was set up immediately around univer.dispose()
      // only, on the assumption that was the sole source of the race —
      // true until a table's resize interaction was also live: its own
      // teardown (tableResize.dispose(), a few lines down) does enough
      // additional async unsubscribing that the EmptyError rejection from
      // univer.dispose() further below could still land after a same-tick
      // removal window, confirmed by a real unmount-with-a-table-present
      // test leaking it as an uncaught rejection despite the guard already
      // being in place.
      const swallowEmptyError = (event: PromiseRejectionEvent) => {
        if (event.reason?.name === "EmptyError") event.preventDefault();
      };
      window.addEventListener("unhandledrejection", swallowEmptyError);

      subscription.unsubscribe();
      commandSubscription.dispose();
      registrations.forEach((registration) => registration.dispose());
      wordRibbon.dispose();
      rulerPart.dispose();
      tableResize.dispose();
      tableMove.dispose();
      DataTransfer.prototype.getData = originalGetData;
      navigator.clipboard.read = originalClipboardRead;
      document.removeEventListener("paste", handleWordPasteCapture, true);
      document.removeEventListener("paste", handleTableAlignAfterPaste, true);
      pageChrome.dispose();
      dialogFocus.dispose();
      spellChecker.dispose();
      trackChanges.dispose();
      window.removeEventListener("beforeunload", flushSave);
      clearTimeout(saveTimeout);
      clearTimeout(statusTimeout);
      flushSave();
      clearRememberedTableRange();

      // univer.dispose() torn down while Univer's async preset init hasn't
      // yet reached its "steady" lifecycle stage (unmounting/navigating away
      // very quickly after mount) leaves an internal
      // firstValueFrom(lifecycle$...) with nothing left to emit once
      // disposal completes the source stream — RxJS rejects that with
      // EmptyError ("no elements in sequence"), surfaced by V8's async
      // stack traces as if thrown right here. Harmless: the instance is
      // being torn down either way. Swallow only this specific error so a
      // fast unmount doesn't crash the dev overlay / bubble as an uncaught
      // rejection, while any other dispose failure still surfaces. (Guard
      // itself is registered at the top of this cleanup function now — see
      // there for why.)

      // Same race, different symptom: dispose() can synchronously unmount
      // an internal React root Univer owns (its own toolbar/canvas overlay)
      // while THIS component's own unmount is still mid-render for the same
      // commit. React reports that via console.error, not a thrown
      // exception, so the try/catch below can't see it — only a scoped
      // console.error filter can. Restored synchronously right after
      // dispose() returns, so no unrelated error in this window gets lost.
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].includes("synchronously unmount a root")) return;
        originalConsoleError(...args);
      };
      try {
        univer.dispose();
      } catch (err) {
        if ((err as Error)?.name !== "EmptyError") throw err;
      } finally {
        console.error = originalConsoleError;
        // A same-tick (0ms) removal was too tight once a table's resize
        // interaction added its own teardown work ahead of this — the
        // EmptyError rejection can land on a later tick than that. 300ms
        // comfortably covers it without leaving the guard live long enough
        // to risk swallowing an unrelated later EmptyError.
        setTimeout(() => {
          window.removeEventListener("unhandledrejection", swallowEmptyError);
          window.removeEventListener("error", suppressKnownBenignUniverErrors);
        }, 300);
      }

      disposedRef.current = false;
      commandServiceRef.current = null;
      documentNameRef.current = () => {};
      rulerGeometryRef.current = () => null;
      setReady(false);
    };
  }, []);

  useImperativeHandle(apiRef, () => ({
    setName: (name: string) => documentNameRef.current(name),
    setZoom: (zoom: number) => {
      void commandServiceRef.current?.executeCommand(SetZoomCommandId, { value: zoom });
    },
    getRulerGeometry: () => rulerGeometryRef.current(),
    setIndents: (indents) => {
      void commandServiceRef.current?.executeCommand(SetIndentCommandId, indents);
    },
    setMargins: (margins) => {
      void commandServiceRef.current?.executeCommand(SetPageMarginsCommandId, margins);
    },
  }));

  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full flex-1">
      {ready && (
        <WordVerticalRuler
          getGeometry={() => rulerGeometryRef.current()}
          onMarginChange={(margins) => {
            void commandServiceRef.current?.executeCommand(SetPageMarginsCommandId, margins);
          }}
        />
      )}
      {pasteDialog && (
        <PasteDialog
          rawHtml={pasteDialog.rawHtml}
          plainText={pasteDialog.plainText}
          editorEl={pasteDialog.editorEl}
          pendingHtmlRef={pendingHtmlRef}
          pendingPlainRef={pendingPlainRef}
          pendingTableAlignRef={pendingTableAlignRef}
          googleDocsPayload={pasteDialog.googleDocsPayload}
          onClose={() => setPasteDialog(null)}
        />
      )}
    </div>
  );
}
