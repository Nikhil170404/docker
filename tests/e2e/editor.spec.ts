import { expect, test, type Page } from "@playwright/test";
import { contractDocxPath, readModelFor } from "./fixtures";

const DOCS_KEY = "docs-default";

/** Waits for Univer's canvas and its first paint. */
async function waitForEditor(page: Page) {
  await page.locator("canvas").first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2_500);
}

/** Opens a file through the ribbon's File > Open. */
async function openDocx(page: Page, path: string) {
  const fileTab = page.locator("text=File").first();
  if (await fileTab.count()) {
    await fileTab.click();
    await page.waitForTimeout(600);
  }
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByText("Open", { exact: true }).first().click(),
  ]);
  await chooser.setFiles(path);
  // The import persists then remounts the editor.
  await page.waitForTimeout(5_000);
  await waitForEditor(page);
  await page.waitForTimeout(2_000);
}

const readModel = (page: Page, key = DOCS_KEY) =>
  page.evaluate(readModelFor(key)) as Promise<Record<string, unknown> | null>;

test.describe("Word editor", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => d.accept());
  });

  test("boots with the full Word ribbon", async ({ page }) => {
    await page.goto("/editor/docs");
    await waitForEditor(page);

    for (const tab of ["File", "Home", "Insert", "Layout", "Review", "View"]) {
      await expect(page.locator(`text=${tab}`).first()).toBeVisible();
    }
  });

  test("accepts typing and counts words", async ({ page }) => {
    await page.goto("/editor/docs");
    await waitForEditor(page);

    await page.locator("canvas").first().click({ position: { x: 300, y: 200 } });
    await page.keyboard.type("The quick brown fox");
    await page.waitForTimeout(1_500);

    await expect(page.locator("text=/\\d+ words/")).toBeVisible();
    const model = await readModel(page);
    expect(String(model?.plain)).toContain("The quick brown fox");
  });

  test("opens a real .docx with all its formatting intact", async ({ page }) => {
    await page.goto("/editor/docs");
    await waitForEditor(page);
    await openDocx(page, await contractDocxPath());

    const model = await readModel(page);
    expect(model).not.toBeNull();

    // Text, in document order, including everything inside the table.
    expect(model!.title).toBe("contract");
    expect(model!.plain).toBe(
      "Master Services Agreement This agreement is made between Acme Corp and the Client. " +
        "1. Fees Payable within 30 days. Late fees apply. Service Rate Consulting " +
        "INR 9,500 / day Signed on the date below.",
    );

    // Structure.
    expect(model!.tables).toBe(1);
    expect(model!.rows).toBe(2);
    expect(model!.columns).toBe(2);
    expect(model!.headerRow).toBe(1);
    expect(model!.cellShading).toBe("#D9E2F3");

    // Formatting.
    expect(model!.headings).toEqual([4, 5]); // Heading 1, Heading 2
    expect(model!.bulleted).toBe(2);
    expect(model!.bold).toBe(3);
    expect(model!.italic).toBe(1);
    expect(model!.colours).toEqual(["#C00000"]);

    // Page geometry: A4 at 96 DPI, 0.75in side margins.
    expect(Number(model!.pageWidth)).toBeCloseTo(793.7, 0);
    expect(model!.marginLeft).toBe(72);
  });

  test("round-trips a document through export and back without drift", async ({
    page,
  }, testInfo) => {
    await page.goto("/editor/docs");
    await waitForEditor(page);
    await openDocx(page, await contractDocxPath());
    const before = await readModel(page);
    expect(before, "the import must have produced a model to compare").toBeTruthy();
    expect(before!.tables).toBe(1);

    // Export to .docx…
    const fileTab = page.locator("text=File").first();
    await fileTab.click();
    await page.waitForTimeout(600);
    await page.getByText("Export", { exact: true }).first().click();
    await page.waitForTimeout(600);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByText("Word document (.docx)", { exact: true }).first().click(),
    ]);
    const roundTripped = testInfo.outputPath("roundtrip.docx");
    await download.saveAs(roundTripped);

    // …and read our own output back in.
    await openDocx(page, roundTripped);
    const after = await readModel(page);

    // Title differs only because the file name does; everything else must
    // survive a full lap. A drift here means the reader and writer disagree.
    expect(after, "re-importing our own export must produce a model").toBeTruthy();
    expect({ ...after, title: null }).toEqual({ ...before, title: null });
  });

  test("reports what it could not import rather than dropping it silently", async ({
    page,
  }) => {
    const messages: string[] = [];
    page.removeAllListeners("dialog");
    page.on("dialog", async (d) => {
      messages.push(d.message());
      await d.accept();
    });

    await page.goto("/editor/docs");
    await waitForEditor(page);
    // The fixture has no images, so no warning is expected — the assertion is
    // that a clean file produces no scary dialog.
    await openDocx(page, await contractDocxPath());
    expect(messages.filter((m) => /left out/i.test(m))).toHaveLength(0);
  });
});

test.describe("pasting from Word", () => {
  test("cleans Word's markup into a real list", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    await page.goto("/editor/docs");
    await waitForEditor(page);
    await page.locator("canvas").first().click({ position: { x: 250, y: 150 } });

    // The shape Word actually puts on the clipboard: fragment markers,
    // downlevel-revealed conditionals, mso-list paragraphs with a literal
    // bullet, and an <o:p> for good measure.
    await page.evaluate(() => {
      const html = [
        "<!--StartFragment-->",
        "<p class=MsoNormal><span style='mso-fareast-font-family:Calibri'>Heading text<o:p></o:p></span></p>",
        "<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>",
        "<![if !supportLists]><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt'>&nbsp;&nbsp;</span></span><![endif]>Alpha item</p>",
        "<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>",
        "<![if !supportLists]><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt'>&nbsp;&nbsp;</span></span><![endif]>Beta item</p>",
        "<!--EndFragment-->",
      ].join("");

      const data = new DataTransfer();
      data.setData("text/html", html);
      data.setData("text/plain", "Heading text\nAlpha item\nBeta item");
      document
        .querySelector("canvas")
        ?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });

    await page.waitForTimeout(3_000);
    const model = await readModel(page);
    const text = String(model?.plain ?? "");

    expect(text).toContain("Alpha item");
    expect(text).toContain("Beta item");
    // Word's own bullet glyph must not survive as text next to a real list
    // marker — the double-bullet everyone complains about.
    expect(text).not.toContain("·");
    // And none of Word's private styling may reach the document.
    expect(JSON.stringify(model)).not.toMatch(/mso-/i);
  });
});
