import { describe, expect, it } from "vitest";
import { cleanPastedHtml, looksLikeWordHtml } from "@/lib/univer/paste-clean";

/**
 * The fixtures below are the shapes Microsoft Word actually puts on the
 * clipboard, abbreviated but not simplified — the awkward parts (unquoted
 * attributes, downlevel-revealed conditionals, `mso-list` paragraphs
 * pretending to be lists) are exactly what breaks naive cleaners.
 */

const WORD_DOCUMENT = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta name=Generator content="Microsoft Word 15">
<style><!-- p.MsoNormal {mso-style-parent:""; margin:0cm; font-size:11.0pt;} --></style>
</head>
<body lang=EN-GB>
<!--StartFragment-->
<p class=MsoNormal><span style='font-size:11.0pt;font-family:"Calibri",sans-serif;mso-fareast-font-family:Calibri;mso-ansi-language:EN-GB'>Hello <b>world</b><o:p></o:p></span></p>
<!--EndFragment-->
</body></html>`;

const WORD_LIST = `<!--StartFragment-->
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>
  <![if !supportLists]><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;</span></span><![endif]>First item</p>
<p class=MsoListParagraphCxSpMiddle style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'>
  <![if !supportLists]><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;</span></span><![endif]>Second item</p>
<p class=MsoListParagraphCxSpLast style='text-indent:-36.0pt;mso-list:l0 level2 lfo1'>
  <![if !supportLists]><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>Nested item</p>
<!--EndFragment-->`;

const WORD_NUMBERED = `<!--StartFragment-->
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'>
  <![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>Payable within 30 days</p>
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'>
  <![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>Late fees apply</p>
<!--EndFragment-->`;

describe("detection", () => {
  it("recognises Word HTML by any of its several tells", () => {
    expect(looksLikeWordHtml(WORD_DOCUMENT)).toBe(true);
    expect(looksLikeWordHtml('<p class=MsoNormal>x</p>')).toBe(true);
    expect(looksLikeWordHtml("<p style='mso-list:l0'>x</p>")).toBe(true);
    expect(looksLikeWordHtml("<p><o:p></o:p></p>")).toBe(true);
  });

  it("does not mistake ordinary HTML for Word", () => {
    expect(looksLikeWordHtml("<p>Just a paragraph</p>")).toBe(false);
    expect(looksLikeWordHtml("<div><strong>Bold</strong></div>")).toBe(false);
  });
});

describe("Word document", () => {
  const result = cleanPastedHtml(WORD_DOCUMENT);

  it("keeps the text and its real formatting", () => {
    expect(result.html).toContain("Hello");
    expect(result.html).toContain("<b>world</b>");
  });

  it("removes every mso- declaration", () => {
    expect(result.html).not.toMatch(/mso-/i);
    expect(result.removed.msoStyles).toBeGreaterThan(0);
  });

  it("removes Office-namespaced elements", () => {
    expect(result.html).not.toContain("<o:p");
    expect(result.html).not.toContain("</o:p>");
  });

  it("drops the stylesheet and the generator meta entirely", () => {
    expect(result.html).not.toContain("MsoNormal {");
    expect(result.html).not.toContain("Microsoft Word");
    expect(result.html).not.toContain("<style");
    expect(result.html).not.toContain("<meta");
  });

  it("keeps only the copied fragment", () => {
    expect(result.html).not.toContain("<html");
    expect(result.html).not.toContain("<body");
  });

  it("drops the Mso class attribute", () => {
    expect(result.html).not.toMatch(/class=/i);
  });
});

describe("Word lists", () => {
  it("becomes a real list, not paragraphs with bullet characters", () => {
    const { html } = cleanPastedHtml(WORD_LIST);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("First item");
    expect(html).toContain("Second item");
  });

  it("does not leave Word's own bullet glyph in the text", () => {
    // The classic double-bullet: a real <li> draws its own marker, so
    // keeping Word's would render "• • First item".
    const { html } = cleanPastedHtml(WORD_LIST);
    expect(html).not.toContain("·");
  });

  it("rebuilds nesting from Word's flat level attributes", () => {
    const { html } = cleanPastedHtml(WORD_LIST);
    // The level-2 item must end up inside a nested list, not a sibling.
    expect(html).toMatch(/<ul>[\s\S]*<ul>[\s\S]*Nested item/);
  });

  it("uses an ordered list when the marker is a number", () => {
    const { html } = cleanPastedHtml(WORD_NUMBERED);
    expect(html).toContain("<ol>");
    expect(html).toContain("Payable within 30 days");
    // Word's own "1." must not survive alongside the list's own numbering.
    expect(html).not.toMatch(/<li[^>]*>\s*1\./);
  });

  it("counts what it converted", () => {
    expect(cleanPastedHtml(WORD_LIST).removed.listsConverted).toBe(3);
  });
});

describe("safety", () => {
  it("removes scripts", () => {
    const { html, removed } = cleanPastedHtml(
      '<p>ok</p><script>alert(1)</script>',
    );
    expect(html).not.toContain("alert");
    expect(html).toContain("ok");
    expect(removed.unsafeElements).toBeGreaterThan(0);
  });

  it("removes event handlers", () => {
    const { html } = cleanPastedHtml('<p onclick="steal()">text</p>');
    expect(html).not.toContain("onclick");
    expect(html).toContain("text");
  });

  it("removes javascript: links but keeps real ones", () => {
    expect(cleanPastedHtml('<a href="javascript:alert(1)">x</a>').html).not.toContain(
      "javascript:",
    );
    expect(cleanPastedHtml('<a href="https://example.com">x</a>').html).toContain(
      "https://example.com",
    );
    expect(cleanPastedHtml('<a href="mailto:a@b.com">x</a>').html).toContain("mailto:");
  });

  it("removes iframes and objects", () => {
    const { html } = cleanPastedHtml(
      '<p>keep</p><iframe src="https://evil.test"></iframe><object data="x"></object>',
    );
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("object");
    expect(html).toContain("keep");
  });

  it("removes url() from styles, which would call out to a server", () => {
    const { html } = cleanPastedHtml(
      `<p style="background-color: url('https://evil.test/track.png')">x</p>`,
    );
    expect(html).not.toContain("evil.test");
  });

  it("keeps a data: image but not a data: document", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(cleanPastedHtml(`<img src="${png}">`).html).toContain(png);
    expect(
      cleanPastedHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">').html,
    ).not.toContain("data:text/html");
  });
});

describe("formatting preservation", () => {
  it("keeps the marks a document actually needs", () => {
    const { html } = cleanPastedHtml(
      "<p><b>b</b><i>i</i><u>u</u><s>s</s><sub>sub</sub><sup>sup</sup></p>",
    );
    for (const tag of ["b", "i", "u", "s", "sub", "sup"]) {
      expect(html).toContain(`<${tag}>`);
    }
  });

  it("keeps headings and tables", () => {
    const { html } = cleanPastedHtml(
      "<h1>Title</h1><table><tr><td>cell</td></tr></table>",
    );
    expect(html).toContain("<h1>");
    expect(html).toContain("<td>");
    expect(html).toContain("cell");
  });

  it("keeps colspan and rowspan", () => {
    const { html } = cleanPastedHtml('<table><tr><td colspan="2">x</td></tr></table>');
    expect(html).toContain('colspan="2"');
  });

  it("keeps the styles that carry meaning", () => {
    const { html } = cleanPastedHtml(
      `<p style="color: #FF0000; text-align: center; mso-ansi-language: EN-GB">x</p>`,
    );
    expect(html).toContain("color");
    expect(html).toContain("text-align");
    expect(html).not.toContain("mso-ansi-language");
  });

  it("drops font-weight: normal, which would cancel an inherited bold", () => {
    const { html } = cleanPastedHtml(
      '<b><span style="font-weight: normal">x</span></b>',
    );
    expect(html).not.toContain("font-weight");
  });

  it("keeps an empty cell, which is part of a table's shape", () => {
    const { html } = cleanPastedHtml("<table><tr><td></td><td>x</td></tr></table>");
    expect(html).toContain("<td></td>");
  });
});

describe("noise removal", () => {
  it("removes empty spans and paragraphs", () => {
    const { html, removed } = cleanPastedHtml(
      "<p><span></span></p><p>real</p><p>   </p>",
    );
    expect(html).toBe("<p>real</p>");
    expect(removed.emptyElements).toBeGreaterThan(0);
  });

  it("unwraps a span that no longer carries anything", () => {
    // WebKit copies every computed property onto spans; once mso- and
    // defaults are gone there is usually nothing left to justify the span.
    const { html } = cleanPastedHtml(
      `<p><span style="mso-fareast-font-family: Calibri">text</span></p>`,
    );
    expect(html).toBe("<p>text</p>");
  });

  it("collapses the non-breaking spaces Word uses as indentation", () => {
    const { html } = cleanPastedHtml("<p>a&nbsp;&nbsp;&nbsp;&nbsp;b</p>");
    expect(html).toBe("<p>a b</p>");
  });

  it("handles an empty or whitespace-only paste", () => {
    expect(cleanPastedHtml("").html).toBe("");
    expect(cleanPastedHtml("   ").html).toBe("");
  });

  it("leaves clean HTML essentially alone", () => {
    const { html } = cleanPastedHtml("<p>Just <b>fine</b> already</p>");
    expect(html).toBe("<p>Just <b>fine</b> already</p>");
  });
});
