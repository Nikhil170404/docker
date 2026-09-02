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

const WORD_HTML_RE = /mso-|xmlns:w=|class="?Mso|ProgId="?Word|Generator.*Microsoft Word|xmlns:o=/i;

function cleanWordHtml(html: string, mode: "keep" | "clean" = "keep"): string {
  // Phase 1: Extract class-based styles from <style> block
  const classStyles = new Map<string, string>();
  const styleBlockMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleBlockMatch) {
    const ruleRx = /\.(\w+)[^{]*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRx.exec(styleBlockMatch[1])) !== null) {
      const props = m[2].split(";").map((p) => p.trim()).filter((p) => p && !/^mso-/i.test(p)).join("; ");
      if (props) classStyles.set(m[1], props);
    }
  }

  // Phase 0: DOM conversions before mso-* stripping
  let working = html;
  try {
    const p0 = new DOMParser().parseFromString(html, "text/html");

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
    p0.querySelectorAll("p").forEach((p) => {
      const brs = [...p.querySelectorAll("br")];
      if (brs.length === 0) return;
      brs.forEach((br) => {
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
          let next = br.nextSibling;
          while (next) { const tmp = next.nextSibling; spanClone.appendChild(next); next = tmp; }
          br.remove();
          parentSpan.insertAdjacentElement("afterend", spanClone);
          // Now move the span clone and everything after it into newP
          let after: ChildNode | null = spanClone;
          while (after) { const tmp = after.nextSibling; newP.appendChild(after); after = tmp; }
        } else {
          let next = br.nextSibling;
          while (next) { const tmp = next.nextSibling; newP.appendChild(next); next = tmp; }
          br.remove();
        }
        p.insertAdjacentElement("afterend", newP);
      });
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
    tmpDoc.querySelectorAll("table").forEach((table) => {
      // Remove <colgroup>/<col> — Univer reads col widths first and would
      // override our scaled cell widths computed below.
      table.querySelectorAll("colgroup, col").forEach((el) => el.remove());
      const totalW = parseFloat((table as HTMLElement).style.width) || parseFloat(table.getAttribute("width") || "") || 0;
      table.removeAttribute("width");
      (table as HTMLElement).style.removeProperty("width");
      (table as HTMLElement).style.setProperty("width", "100%");
      (table as HTMLElement).style.setProperty("border-collapse", "collapse");
      const isBorderless = table.getAttribute("border") === "0";
      // Word marks merged-cell "phantom" placeholders with display:none — remove them
      // so Univer doesn't render empty phantom cells as visible blank columns.
      table.querySelectorAll<HTMLElement>("td[style*='display:none'], td[style*='display: none']").forEach((td) => td.remove());
      const cells = [...table.querySelectorAll("td, th")] as HTMLElement[];
      cells.forEach((cell) => {
        const cellW = parseFloat(cell.style.width) || parseFloat(cell.getAttribute("width") || "") || 0;
        cell.removeAttribute("width");
        cell.style.removeProperty("width");
        if (totalW > 0 && cellW > 0) {
          const scaledPx = Math.round((cellW / totalW) * 660);
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

    // Headings: preserve heading semantics via data-heading attribute so
    // Univer's getHeadingNamedStyleType fires, while also adding UniverNormal
    // for paragraph style resolution (text-align, line-height, spacing).
    tmpDoc.querySelectorAll("h1, h2, h3, h4, h5").forEach((h) => {
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

// ─── Paste-from-Word dialog ────────────────────────────────────────────────────

function PasteDialog({
  rawHtml,
  plainText,
  editorEl,
  pendingHtmlRef,
  pendingPlainRef,
  onClose,
}: {
  rawHtml: string;
  plainText: string;
  editorEl: Element | null;
  pendingHtmlRef: React.RefObject<string | null>;
  pendingPlainRef: React.RefObject<string | null>;
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
    } else {
      html = cleanWordHtml(rawHtml, mode);
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
  const [pasteDialog, setPasteDialog] = useState<{
    rawHtml: string;
    plainText: string;
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
      return {
        pageLeft: canvasOffset + (documents.left - scrollX) * scale,
        pageTop: canvasRect.top - containerRect.top + (documents.top - scrollY) * scale,
        pageWidth: style.pageSize.width * scale,
        pageHeight: (style.pageSize.height ?? 1123) * scale,
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
      if (type === "text/html" && WORD_HTML_RE.test(data)) return cleanWordHtml(data);
      return data;
    };

    const handleWordPasteCapture = (e: ClipboardEvent) => {
      const html = originalGetData.call(e.clipboardData, "text/html") as string;
      if (!html || !WORD_HTML_RE.test(html)) return;
      e.preventDefault();
      e.stopPropagation();
      const plain = originalGetData.call(e.clipboardData, "text/plain") as string;
      setPasteDialog({ rawHtml: html, plainText: plain, editorEl: document.activeElement });
    };
    document.addEventListener("paste", handleWordPasteCapture, true);

    // Secondary interception: programmatic clipboard reads
    const originalClipboardRead = navigator.clipboard.read.bind(navigator.clipboard);
    navigator.clipboard.read = async (...args) => {
      const items = await originalClipboardRead(...args);
      const cleaned: ClipboardItem[] = [];
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const html = await blob.text();
          if (WORD_HTML_RE.test(html)) {
            const parts: Record<string, Blob | Promise<Blob>> = {
              "text/html": new Blob([cleanWordHtml(html)], { type: "text/html" }),
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
      // rejection, while any other dispose failure still surfaces.
      const swallowEmptyError = (event: PromiseRejectionEvent) => {
        if (event.reason?.name === "EmptyError") event.preventDefault();
      };
      window.addEventListener("unhandledrejection", swallowEmptyError);

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
        setTimeout(() => window.removeEventListener("unhandledrejection", swallowEmptyError), 0);
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
          onClose={() => setPasteDialog(null)}
        />
      )}
    </div>
  );
}
