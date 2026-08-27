import { expect, test, type Page } from "@playwright/test";

const KEY = "dk_test_0s-MJE_zHjqhAycP8NZcAcjx83CjJRDTFWC_HMhpd_E";

const PAGES = [
  "/",
  "/pricing",
  "/compare",
  "/embed-demo",
  "/api-docs",
  "/status",
  "/legal/privacy",
  "/legal/terms",
];

/** Collects anything the browser reports as broken while a page loads. */
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test.describe("marketing pages", () => {
  for (const path of PAGES) {
    test(`${path} renders without console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      const response = await page.goto(path);

      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("h1, h2").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("every navbar link resolves", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator("header a").evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
    );

    for (const href of new Set(hrefs.filter((h) => h.startsWith("/")))) {
      const res = await page.request.get(href);
      expect(res.status(), `${href} should resolve`).toBeLessThan(400);
    }
  });

  test("sitemap lists the pages that exist, and none that do not", async ({
    page,
  }) => {
    const xml = await (await page.request.get("/sitemap.xml")).text();
    const paths = [...xml.matchAll(/<loc>[^<]*?(\/[^<]*)?<\/loc>/g)];
    expect(paths.length).toBeGreaterThan(5);

    for (const route of ["/pricing", "/compare", "/embed-demo", "/api-docs"]) {
      expect(xml).toContain(route);
    }
    // The embed itself is a widget, not a page to index.
    expect(xml).not.toContain("/e/");
  });
});

test.describe("pricing page", () => {
  test("switches between the team and developer tracks", async ({ page }) => {
    await page.goto("/pricing");

    await page.getByRole("button", { name: "For developers" }).click();
    await expect(page.locator("text=5,000 editor loads / month")).toBeVisible();
    await expect(page.locator("text=No overage billing")).toBeVisible();

    await page.getByRole("button", { name: "For teams" }).click();
    await expect(page.locator("text=Docs + Sheets editors")).toBeVisible();
  });

  test("switches currency and billing period", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("button", { name: "For developers" }).click();

    await expect(page.locator("text=₹999").first()).toBeVisible();
    await page.getByRole("button", { name: "usd", exact: true }).click();
    await expect(page.locator("text=$29").first()).toBeVisible();

    // Yearly charges ten months over twelve: $29 -> $24/mo equivalent.
    await page.getByRole("button", { name: /yearly/i }).click();
    await expect(page.locator("text=$24").first()).toBeVisible();
  });
});

test.describe("comparison page", () => {
  test("recalculates every cost as the volume slider moves", async ({ page }) => {
    await page.goto("/compare");
    const slider = page.locator("#loads");
    await expect(slider).toBeVisible();

    const setVolume = async (index: number) => {
      await slider.evaluate((el, value) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(el, String(value));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, index);
      await page.waitForTimeout(200);
    };

    await setVolume(4); // 50k loads
    await expect(page.locator("text=$29").first()).toBeVisible();
    await expect(page.locator("text=Auto-charged on overage").first()).toBeVisible();

    await setVolume(8); // 1M loads — past every published rival tier
    await expect(page.locator("text=Custom").first()).toBeVisible();
  });

  test("dates its competitor figures instead of implying they are live", async ({
    page,
  }) => {
    await page.goto("/compare");
    await expect(page.locator("text=/published list prices as of/i")).toBeVisible();
  });
});

test.describe("public API", () => {
  test("refuses an unauthenticated call", async ({ request }) => {
    const res = await request.get("/api/v1/documents");
    expect(res.status()).toBe(401);
  });

  test("serves usage headers on an authenticated call", async ({ request }) => {
    const res = await request.get("/api/v1/documents", {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["x-dockaro-overage-billing"]).toBe("none");
    expect(Number(res.headers()["x-dockaro-loads-limit"])).toBeGreaterThan(0);
  });

  test("creates a document and points it at a real embed URL", async ({ request }) => {
    const res = await request.post("/api/v1/documents", {
      headers: { Authorization: `Bearer ${KEY}` },
      data: { type: "docx", title: "E2E Invoice" },
    });
    expect(res.status()).toBe(201);

    const doc = await res.json();
    expect(doc.editUrl).toContain(`/e/${doc.id}`);

    // The editUrl must resolve — it used to point at a route that did not exist.
    const embed = await request.get(`/e/${doc.id}?mode=document`);
    expect(embed.status()).toBeLessThan(400);
  });
});
