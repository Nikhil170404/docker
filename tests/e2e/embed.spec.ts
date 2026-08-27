import { expect, test, type Page } from "@playwright/test";
import { contractDocxPath } from "./fixtures";

/** Waits for the SDK to report the editor ready on the demo page. */
async function mountDemo(page: Page, mode: "richtext" | "document") {
  await page.goto("/embed-demo");
  await page.waitForSelector('[data-testid="embed-status"]:text("ready")');
  if (mode === "document") {
    await page.getByRole("button", { name: "Document (.docx out)" }).click();
    await page.waitForSelector('[data-testid="embed-status"]:text("ready")');
  }
  await page.frameLocator("#dockaro-editor iframe").locator("canvas").first().waitFor();
  await page.waitForTimeout(2_000);
}

const output = (page: Page) =>
  page.locator('[data-testid="embed-output"]').innerText();

test.describe("embed SDK", () => {
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => d.accept());
  });

  test("serves the SDK as a plain script with no dependencies", async ({ request }) => {
    const res = await request.get("/dockaro.js");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("DocKaro.mount");
    // A build step or a bare import would break the one-script-tag promise.
    expect(body).not.toMatch(/^\s*import\s/m);
    expect(body).not.toContain("require(");
  });

  test("the embed route refuses to be indexed", async ({ page }) => {
    await page.goto("/e/test-doc?mode=richtext");
    const robots = await page
      .locator('head meta[name="robots"]')
      .getAttribute("content");
    expect(robots).toMatch(/noindex/i);
  });

  test("mounts rich-text mode without the Word chrome", async ({ page }) => {
    await mountDemo(page, "richtext");
    const frame = page.frameLocator("#dockaro-editor iframe");

    // Continuous flow: a compact toolbar, and none of the ribbon's tabs.
    await expect(frame.locator("canvas").first()).toBeVisible();
    await expect(page.locator("#dockaro-editor iframe")).toHaveCount(1);
    expect(await frame.locator("body").innerText()).not.toContain("Layout");
  });

  test("mounts document mode with the full ribbon", async ({ page }) => {
    await mountDemo(page, "document");
    const frame = page.frameLocator("#dockaro-editor iframe");
    const text = await frame.locator("body").innerText();

    for (const tab of ["File", "Home", "Insert", "Layout", "Review"]) {
      expect(text).toContain(tab);
    }
  });

  test("returns typed content as an HTML fragment", async ({ page }) => {
    await mountDemo(page, "richtext");
    const frame = page.frameLocator("#dockaro-editor iframe");

    await frame.locator("canvas").first().click({ position: { x: 120, y: 40 } });
    await page.keyboard.type("Hello from the host page.");
    await page.waitForTimeout(1_500);

    await page.getByRole("button", { name: "getHTML()" }).click();
    await page.waitForSelector('[data-testid="embed-output"]');

    const html = await output(page);
    expect(html).toContain("Hello from the host page.");
    expect(html).toContain("<p");
    // A fragment, not a whole document — it goes inside the host's page.
    expect(html).not.toContain("<html");
    expect(html).not.toContain("<!DOCTYPE");
  });

  test("returns a real .docx blob", async ({ page }) => {
    await mountDemo(page, "document");
    const frame = page.frameLocator("#dockaro-editor iframe");
    await frame.locator("canvas").first().click({ position: { x: 200, y: 120 } });
    await page.keyboard.type("Invoice body");
    await page.waitForTimeout(1_500);

    await page.getByRole("button", { name: "getDocx()" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="embed-output"]')
        ?.textContent?.includes("bytes"),
    );

    const text = await output(page);
    expect(text).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const size = Number(text.match(/([\d,]+) bytes/)?.[1].replace(/,/g, ""));
    expect(size).toBeGreaterThan(1_000);
  });

  test("reports word count back to the host as the user types", async ({ page }) => {
    await mountDemo(page, "richtext");
    const frame = page.frameLocator("#dockaro-editor iframe");
    await frame.locator("canvas").first().click({ position: { x: 120, y: 40 } });
    await page.keyboard.type("one two three four five");
    await page.waitForTimeout(2_000);

    await expect(page.locator("text=/[1-9]\\d* words/")).toBeVisible();
  });

  test("loads a .docx the host hands it", async ({ page }) => {
    await mountDemo(page, "document");

    await page.setInputFiles(
      '[data-testid="embed-load-docx"]',
      await contractDocxPath(),
    );
    await page.waitForSelector('[data-testid="embed-output"]');
    expect(await output(page)).toContain("contract.docx");

    // The frame reloads with the imported document.
    await page.waitForTimeout(6_000);
    await page.frameLocator("#dockaro-editor iframe").locator("canvas").first().waitFor();
    await page.waitForTimeout(2_000);

    await page.getByRole("button", { name: "getHTML()" }).click();
    await page.waitForTimeout(2_000);

    const html = await output(page);
    expect(html).toContain("Master Services Agreement");
    expect(html).toContain("Consulting");
    expect(html).toContain("INR 9,500 / day");
  });

  test("keeps the two modes in separate documents", async ({ page }) => {
    await mountDemo(page, "richtext");
    const frame = page.frameLocator("#dockaro-editor iframe");
    await frame.locator("canvas").first().click({ position: { x: 120, y: 40 } });
    await page.keyboard.type("only in rich text");
    await page.waitForTimeout(2_000);

    await page.getByRole("button", { name: "Document (.docx out)" }).click();
    await page.waitForSelector('[data-testid="embed-status"]:text("ready")');
    await page.waitForTimeout(2_500);

    await page.getByRole("button", { name: "getHTML()" }).click();
    await page.waitForTimeout(1_500);
    expect(await output(page)).not.toContain("only in rich text");
  });
});
