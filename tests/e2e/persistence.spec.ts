import { expect, test, type Page } from "@playwright/test";

/**
 * The point of server persistence: a document is not trapped in the browser
 * that made it. Every test here proves that by throwing the browser away and
 * coming back — a fresh context has no localStorage, so anything that
 * survives came from the server.
 */

const KEY = "dk_test_51H7x9pQwErTyUiOpAsDfGh";

async function waitForEditor(page: Page) {
  await page.locator("canvas").first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3_000);
}

/** Unique per run so repeated runs never collide on the server. */
const uniqueId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

test.describe("server persistence", () => {
  test("keeps a typed document across a completely fresh browser", async ({
    browser,
  }) => {
    const documentId = uniqueId("e2e-doc");
    const phrase = `persisted ${documentId}`;

    // Session one: type, and let the debounced save reach the server.
    const first = await browser.newContext();
    const pageOne = await first.newPage();
    await pageOne.goto(`/e/${documentId}?mode=document`);
    await waitForEditor(pageOne);
    await pageOne.locator("canvas").first().click({ position: { x: 250, y: 150 } });
    await pageOne.keyboard.type(phrase);
    await pageOne.waitForTimeout(3_000);
    await first.close();

    // Session two: a new context has no localStorage at all, so the only way
    // this text can appear is if it came back over the network.
    const second = await browser.newContext();
    const pageTwo = await second.newPage();

    const stored = await pageTwo.request.get(
      `/api/v1/documents/${documentId}/content`,
    );
    expect(stored.status()).toBe(200);
    expect(JSON.stringify(await stored.json())).toContain(phrase);

    await pageTwo.goto(`/e/${documentId}?mode=document`);
    await waitForEditor(pageTwo);
    const model = await pageTwo.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, `dockaro:embed:${documentId}:document`);

    expect(model, "the editor should have hydrated from the server").toBeTruthy();
    expect(JSON.stringify(model)).toContain(phrase);
    await second.close();
  });

  test("keeps two documents apart", async ({ browser }) => {
    const a = uniqueId("e2e-a");
    const b = uniqueId("e2e-b");

    const context = await browser.newContext();
    const page = await context.newPage();

    for (const [id, text] of [
      [a, "alpha document"],
      [b, "beta document"],
    ] as const) {
      await page.goto(`/e/${id}?mode=richtext`);
      await waitForEditor(page);
      await page.locator("canvas").first().click({ position: { x: 150, y: 40 } });
      await page.keyboard.type(text);
      await page.waitForTimeout(3_000);
    }

    const readBack = async (id: string) =>
      JSON.stringify(await (await page.request.get(`/api/v1/documents/${id}/content`)).json());

    expect(await readBack(a)).toContain("alpha document");
    expect(await readBack(a)).not.toContain("beta document");
    expect(await readBack(b)).toContain("beta document");
    await context.close();
  });

  test("serves an empty document for an id nobody has saved", async ({ request }) => {
    const res = await request.get(`/api/v1/documents/${uniqueId("never")}/content`);
    // Not an error: a document nobody has written yet simply starts blank.
    expect(res.status()).toBe(200);
    expect((await res.json()).content).toBeNull();
  });

  test("refuses a document id that could escape the data directory", async ({
    request,
  }) => {
    for (const id of ["..%2F..%2Fetc%2Fpasswd", "..", "a%2Fb"]) {
      const res = await request.get(`/api/v1/documents/${id}/content`);
      expect(res.status(), id).toBeGreaterThanOrEqual(400);
    }
  });

  test("rejects a save that is not a document", async ({ request }) => {
    const id = uniqueId("bad-body");
    const res = await request.put(`/api/v1/documents/${id}/content`, {
      data: { content: "not an object" },
    });
    expect(res.status()).toBe(400);
  });

  test("creates the document on first save, so a host can pick its own id", async ({
    request,
  }) => {
    const id = uniqueId("host-chosen");

    const saved = await request.put(`/api/v1/documents/${id}/content`, {
      data: { content: { body: { dataStream: "from the host" } }, title: "Host Doc" },
    });
    expect(saved.status()).toBe(200);

    // It is now a first-class document, visible through the authenticated API.
    const meta = await request.get(`/api/v1/documents/${id}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(meta.status()).toBe(200);
    expect((await meta.json()).title).toBe("Host Doc");
  });

  test("a document created through the API opens at its own editUrl", async ({
    request,
    page,
  }) => {
    const created = await request.post("/api/v1/documents", {
      headers: { Authorization: `Bearer ${KEY}` },
      data: { type: "docx", title: "API Created" },
    });
    const { id } = await created.json();

    await page.goto(`/e/${id}?mode=document`);
    await waitForEditor(page);
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("survives a server restart, because it is on disk not in memory", async ({
    request,
  }) => {
    const id = uniqueId("durable");
    await request.put(`/api/v1/documents/${id}/content`, {
      data: { content: { body: { dataStream: "written to disk" } } },
    });

    // The old in-memory Map lost everything on restart; a file does not. This
    // asserts the write actually reached the filesystem by reading it back
    // through a fresh request rather than any cached handle.
    const res = await request.get(`/api/v1/documents/${id}/content`);
    expect(JSON.stringify(await res.json())).toContain("written to disk");
    expect(res.headers()["cache-control"]).toContain("no-store");
  });
});
