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

    // Word paste: Microsoft Word copies rich HTML with mso-* styles and
    // explicit pixel widths that overflow Univer's A4 page. Clean it before
    // Univer's paste handler reads it.
    //
    // Univer reads clipboard content through the browser's paste event via
    // clipboardData.getData("text/html") — NOT navigator.clipboard.read —
    // so we patch DataTransfer.prototype.getData to intercept at that layer.
    // We also patch navigator.clipboard.read for any programmatic reads.
    function cleanWordHtml(html: string): string {
      // ── Phase 1: Extract class-based styles ────────────────────────────
      // Read from the original html string (the <style> block is in <head>
      // and won't appear in body.innerHTML after a DOMParser pass).
      const classStyles = new Map<string, string>();
      const styleBlockMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      if (styleBlockMatch) {
        const ruleRx = /\.(\w+)[^{]*\{([^}]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = ruleRx.exec(styleBlockMatch[1])) !== null) {
          // Keep only standard (non-mso-*) CSS declarations
          const props = m[2]
            .split(";")
            .map((p) => p.trim())
            .filter((p) => p && !/^mso-/i.test(p))
            .join("; ");
          if (props) classStyles.set(m[1], props);
        }
      }

      // ── Phase 0: Word-structure conversions (before mso-* stripping) ──
      // DOMParser makes <![if…]>…<![endif]> conditionals available as DOM
      // nodes (the <![…]> markers become bogus-comment nodes and the inner
      // elements are regular DOM children). We use this window to fix
      // structures that depend on mso-* attributes or markers that our regex
      // phase will later strip.
      let working = html;
      try {
        const p0 = new DOMParser().parseFromString(html, "text/html");

        // ① Convert MsoHeading paragraphs to proper heading elements.
        //   Univer's paste parser detects headings by tagName (H1–H5), not
        //   by class. Without this, heading text pastes as styled plain text
        //   and the outline / TOC commands cannot find it.
        p0.querySelectorAll("p").forEach((p) => {
          const m = (p as HTMLElement).className.match(/\bMsoHeading(\d)\b/i);
          if (!m) return;
          const level = Math.min(5, Number(m[1]));
          const h = p0.createElement(`h${level}`);
          [...(p as HTMLElement).attributes].forEach((a) => h.setAttribute(a.name, a.value));
          h.innerHTML = p.innerHTML;
          p.replaceWith(h);
        });

        // ② Convert Word list paragraphs to <ul>/<ol>/<li>.
        //   Word uses <p class="MsoListParagraph" style="mso-list:l0 level1">
        //   instead of <ul>/<li>. extractWordListInfo() in Univer reads the
        //   mso-list: attribute, but our Phase 2 regex strips all mso-*
        //   properties first. Converting to proper HTML lists here ensures
        //   Univer's _processBeforeList() creates correctly typed list items.
        (function convertWordLists(doc: Document) {
          const isWordListPara = (el: Element): el is HTMLElement =>
            el.tagName === "P" &&
            ((el.getAttribute("style") ?? "").includes("mso-list:") ||
              /MsoListParagraph/i.test((el as HTMLElement).className));

          // Collect unique parent containers of list paragraphs
          const containers = new Set<Element>();
          doc.querySelectorAll("p").forEach((p) => {
            if (isWordListPara(p)) containers.add(p.parentElement ?? doc.body);
          });

          for (const container of containers) {
            const kids = Array.from(container.children);
            let i = 0;
            while (i < kids.length) {
              if (!isWordListPara(kids[i])) { i++; continue; }

              // Collect a run of consecutive list-item paragraphs
              const group: HTMLElement[] = [];
              while (i < kids.length && isWordListPara(kids[i])) {
                group.push(kids[i] as HTMLElement);
                i++;
              }

              // Detect ordered/unordered from the first item's marker span.
              // Browsers parse <![if !supportLists]><span>1.</span><![endif]>
              // as: bogus-comment, then the span as a regular DOM node, then
              // another bogus-comment. The marker span has style "mso-list:Ignore".
              const ignoreSpan = group[0].querySelector<HTMLElement>(
                '[style*="mso-list:Ignore"]'
              );
              const markerText = (ignoreSpan?.textContent ?? "").replace(/\s/g, "");
              // "1." "a." "i." etc. → ordered list; bullets or empty → unordered
              const ordered = /^[0-9]+[.)]|^[a-zA-Z]{1,3}[.)]/.test(markerText);

              const listEl = doc.createElement(ordered ? "ol" : "ul");

              group.forEach((p) => {
                // Remove marker spans before copying content to <li>
                p.querySelectorAll('[style*="mso-list:Ignore"]').forEach((s) => s.remove());

                const li = doc.createElement("li");
                li.innerHTML = p.innerHTML;
                // Copy class so style baking works on the <li>
                const cls = p.getAttribute("class");
                if (cls) li.setAttribute("class", cls);
                // Copy non-layout, non-mso styles
                const rawStyle = (p.getAttribute("style") ?? "")
                  .split(";")
                  .filter((s) => s.trim() && !/^mso-|text-indent/i.test(s.trim()))
                  .join("; ")
                  .trim();
                if (rawStyle) li.setAttribute("style", rawStyle);
                listEl.appendChild(li);
              });

              group[0].replaceWith(listEl);
              group.slice(1).forEach((el) => el.remove());
            }
          }
        })(p0);

        // ③ Convert <br> inside paragraphs to paragraph splits so Univer
        //   renders them as separate lines instead of silently dropping them.
        p0.querySelectorAll("p").forEach((p) => {
          const brs = p.querySelectorAll("br");
          if (brs.length === 0) return;
          brs.forEach((br) => {
            // Split the paragraph at the <br>: close current <p> and open a new one
            const newP = p0.createElement("p");
            // Copy class / style of the parent so the new paragraph inherits formatting
            const cls = p.getAttribute("class");
            const sty = p.getAttribute("style");
            if (cls) newP.setAttribute("class", cls);
            if (sty) newP.setAttribute("style", sty);
            // Move all remaining siblings after the <br> into the new paragraph
            let next = br.nextSibling;
            while (next) {
              const tmp = next.nextSibling;
              newP.appendChild(next);
              next = tmp;
            }
            br.remove();
            p.insertAdjacentElement("afterend", newP);
          });
        });

        // ④ Convert CSS super/subscript spans to semantic tags so Univer's
        //   extractNodeStyle() picks them up (it handles <sup>/<sub> tags but
        //   not the CSS vertical-align property).
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

        working = p0.body.innerHTML;
      } catch { /* DOMParser unavailable — continue with original */ }

      // ── Phase 2: Regex cleanup ──────────────────────────────────────────
      // After Phase 0, <![if…]>…<![endif]> conditionals have been serialised
      // back as standard HTML comments (<!--[if…]-->…<!--[endif]-->). The
      // <img> elements they contained are now free-standing DOM nodes, so
      // stripping the comment wrappers is safe.
      let clean = working
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        // Strip original-format VML conditional blocks entirely
        .replace(/<!--\[if\s+vml\b[\s\S]*?<!\[endif\]-->/gi, "")
        // Unwrap original-format non-vml conditionals (keep their content — images etc.)
        .replace(/<!--\[if\s*![^\]]*\]>([\s\S]*?)<!\[endif\]-->/gi, "$1")
        // Strip remaining original-format conditional comments
        .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
        // Strip comment-form wrappers left by Phase 0's DOMParser serialisation
        .replace(/<!--\[if[^\]]*\]-->/gi, "")
        .replace(/<!--\[endif\]-->/gi, "")
        // Strip <o:p> tags AND their content (they add stray &nbsp; whitespace)
        .replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, "")
        .replace(/<o:p\s*\/>/gi, "")
        .replace(/<\/?w:[^>]*>/gi, "").replace(/<\/?v:[^>]*>/gi, "").replace(/<\/?m:[^>]*>/gi, "")
        // Strip mso-* from double-quoted style attributes
        .replace(/(style="[^"]*?)(?:\s*mso-[^:]+:[^;";]+;?)+/gi, "$1")
        // Strip mso-* from single-quoted style attributes (Word uses both)
        .replace(/(style='[^']*?)(?:\s*mso-[^:]+:[^;';]+;?)+/gi, "$1")
        .replace(/\s+xmlns[^=]*="[^"]*"/gi, "")
        .replace(/\s+(?:v|o|w):\w+="[^"]*"/gi, "");

      // ── Phase 3: DOMParser normalisation ───────────────────────────────
      try {
        const tmpDoc = new DOMParser().parseFromString(clean, "text/html");

        // Bake class-based styles into inline styles (inline styles win over class)
        if (classStyles.size > 0) {
          tmpDoc.querySelectorAll("[class]").forEach((el) => {
            const classes = (el as HTMLElement).className.split(/\s+/);
            const fromClass = classes
              .filter((c) => classStyles.has(c))
              .map((c) => classStyles.get(c)!)
              .join("; ");
            if (fromClass) {
              const existing = (el as HTMLElement).style.cssText;
              // class props go first so inline props override them
              (el as HTMLElement).style.cssText = fromClass + (existing ? "; " + existing : "");
            }
          });
        }

        // Strip any remaining mso-* properties from ALL element inline styles.
        tmpDoc.querySelectorAll("*").forEach((el) => {
          const s = (el as HTMLElement).style;
          if (!s?.cssText) return;
          s.cssText = s.cssText.replace(/\s*mso-[^:]+:[^;]+;?\s*/gi, "").trim();
        });

        // Strip explicit <tr> height so Univer uses TableRowHeightRule.AT_LEAST
        // (auto-grow) instead of EXACT, which clips text when content overflows.
        tmpDoc.querySelectorAll("tr").forEach((tr) => {
          tr.removeAttribute("height");
          (tr as HTMLElement).style.removeProperty("height");
        });

        // Normalize table widths: table → 100%, cells → proportional px.
        // IMPORTANT: Univer's readCssSize() only recognises px/pt/in/cm/mm —
        // percentage widths return undefined and fall back to equal-width columns.
        // We scale cell widths to Univer's DEFAULT_TABLE_WIDTH (660 px) so that
        // proportions are preserved and the values are readable by the parser.
        tmpDoc.querySelectorAll("table").forEach((table) => {
          const totalW =
            parseFloat((table as HTMLElement).style.width) ||
            parseFloat(table.getAttribute("width") || "") || 0;
          table.removeAttribute("width");
          (table as HTMLElement).style.removeProperty("width");
          (table as HTMLElement).style.setProperty("width", "100%");
          (table as HTMLElement).style.setProperty("border-collapse", "collapse");

          // Word marks borderless tables with border="0". We need to tell
          // Univer's HTML parser (nt() function) to produce zero-width borders
          // rather than leaving the border property absent. When absent, Univer's
          // renderer falls back to its default grey line. border:none is treated
          // as absent (nt() returns undefined); "0px solid #000000" produces
          // { color, width: 0 } which the renderer correctly skips.
          const isBorderless = table.getAttribute("border") === "0";

          const cells = [...table.querySelectorAll("td, th")] as HTMLElement[];
          cells.forEach((cell) => {
            const cellW =
              parseFloat(cell.style.width) ||
              parseFloat(cell.getAttribute("width") || "") || 0;
            cell.removeAttribute("width");
            cell.style.removeProperty("width");
            // Scale to Univer's 660 px content width (px is a recognised unit;
            // % is NOT recognised by readCssSize and produces equal-width columns)
            if (totalW > 0 && cellW > 0) {
              const scaledPx = Math.round((cellW / totalW) * 660);
              cell.style.setProperty("width", `${scaledPx}px`);
              cell.setAttribute("width", String(scaledPx));
            }
            // For borderless Word tables: set 0-width borders on all four sides.
            // "border:none" makes nt() return undefined → Univer draws grey fallback.
            // "0px solid #000" makes nt() return { width: 0 } → renderer skips it.
            if (isBorderless && !cell.style.borderTop) {
              cell.style.setProperty("border-top",    "0px solid #000000");
              cell.style.setProperty("border-right",  "0px solid #000000");
              cell.style.setProperty("border-bottom", "0px solid #000000");
              cell.style.setProperty("border-left",   "0px solid #000000");
            }
            // Univer skips cells with no block-level content — empty Word cells
            // (e.g. layout tables or invoice grids) become invisible. Add a
            // placeholder paragraph so the cell is always rendered.
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

        // Add UniverNormal class to <p> elements so Univer's UniverPastePlugin
        // fires its afterProcessRules for them and applies paragraph-level CSS
        // (text-align, line-height, margin-top, margin-bottom) — properties
        // that the default _appendParagraph path does not read.
        tmpDoc.querySelectorAll("p").forEach((p) => {
          (p as HTMLElement).className = ((p as HTMLElement).className + " UniverNormal").trim();
        });

        clean = tmpDoc.body.innerHTML;
      } catch { /* DOMParser unavailable — keep regex-cleaned version */ }
      return clean;
    }

    // Primary interception: paste event's clipboardData.getData()
    const isWordHtml = /mso-|xmlns:w=|class="?Mso|ProgId="?Word|Generator.*Microsoft Word|xmlns:o=/i;
    const originalGetData = DataTransfer.prototype.getData;
    DataTransfer.prototype.getData = function (type: string): string {
      const data = originalGetData.call(this, type) as string;
      if (type === "text/html" && isWordHtml.test(data)) return cleanWordHtml(data);
      return data;
    };

    // Secondary interception: programmatic clipboard reads
    const originalClipboardRead = navigator.clipboard.read.bind(navigator.clipboard);
    navigator.clipboard.read = async (...args) => {
      const items = await originalClipboardRead(...args);
      const cleaned: ClipboardItem[] = [];
      for (const item of items) {
        if (item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          const html = await blob.text();
          if (isWordHtml.test(html)) {
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
    </div>
  );
}
