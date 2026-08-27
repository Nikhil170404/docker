import { expect, test } from "@playwright/test";

/**
 * These run against a deployment with no Supabase project and no Razorpay
 * keys, which is the state a contributor clones into. That is deliberately
 * the case worth testing here: the app has to stay usable and honest without
 * credentials, and every paid path has to refuse cleanly rather than half-
 * work. The signed-in flows are covered by the unit suite, which can hold
 * real secrets without needing a live account.
 */

test.describe("without credentials configured", () => {
  test("the sign-in page explains itself instead of breaking", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/signin");
    await expect(page.getByTestId("auth-unconfigured")).toBeVisible();
    await expect(page.locator("text=NEXT_PUBLIC_SUPABASE_URL")).toBeVisible();
    // The important half of the message: the product still works.
    await expect(page.locator("text=/editor works without an account/i")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the account page says so rather than pretending to be signed in", async ({
    page,
  }) => {
    await page.goto("/account");
    await expect(page.locator("text=Not signed in")).toBeVisible();
    await expect(page.locator("text=/not configured/i")).toBeVisible();
  });

  test("checkout refuses with a clear reason", async ({ request }) => {
    const res = await request.post("/api/v1/billing/checkout", {
      data: { planId: "embed-starter", currency: "usd", period: "monthly" },
    });
    expect(res.status()).toBe(503);
    expect((await res.json()).error.code).toBe("billing_unavailable");
  });

  test("the webhook refuses rather than accepting unverifiable events", async ({
    request,
  }) => {
    const res = await request.post("/api/v1/billing/webhook", {
      data: { event: "payment.captured", payload: {} },
    });
    // 503 unconfigured, 401 configured-but-unsigned; never 200.
    expect([401, 503]).toContain(res.status());
  });

  test("the subscription endpoint requires a session", async ({ request }) => {
    const res = await request.get("/api/v1/billing/subscription");
    expect(res.status()).toBe(401);
  });

  test("the editor still works with no account at all", async ({ page }) => {
    // The whole point of degrading rather than gating: a visitor can use the
    // product before they have signed up for anything.
    await page.goto("/editor/docs");
    await page.locator("canvas").first().waitFor({ timeout: 120_000 });
    await expect(page.locator("text=Layout").first()).toBeVisible();
  });
});

test.describe("pricing page checkout", () => {
  test("paid plans offer a checkout, free plans just link into the product", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await page.getByRole("button", { name: "For developers" }).click();

    // Free tier: a link, not a payment.
    await expect(page.getByTestId("checkout-embed-free")).toHaveCount(0);
    await expect(page.getByTestId("checkout-embed-starter")).toBeVisible();
    await expect(page.getByTestId("checkout-embed-growth")).toBeVisible();
  });

  test("tells the visitor when payments are not enabled", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("button", { name: "For developers" }).click();
    await page.getByTestId("checkout-embed-starter").click();

    await expect(page.getByTestId("checkout-unavailable")).toBeVisible();
  });

  test("keeps working in both currencies", async ({ page }) => {
    await page.goto("/pricing");
    await page.getByRole("button", { name: "For developers" }).click();

    await expect(page.locator("text=₹999").first()).toBeVisible();
    await page.getByRole("button", { name: "usd", exact: true }).click();
    await expect(page.locator("text=$29").first()).toBeVisible();
    await expect(page.getByTestId("checkout-embed-starter")).toBeVisible();
  });
});

test.describe("route protection", () => {
  test("the account page is not indexable", async ({ page }) => {
    await page.goto("/account");
    const robots = await page
      .locator('head meta[name="robots"]')
      .getAttribute("content");
    expect(robots).toMatch(/noindex/i);
  });

  test("the auth callback never redirects off-site", async ({ page, baseURL }) => {
    // An open redirect here would let a phishing link borrow our domain.
    await page.goto("/auth/callback?next=https://evil.example.com");
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });

  test("a protocol-relative redirect target is refused too", async ({
    page,
    baseURL,
  }) => {
    // "//host" is a URL with no scheme, not a path — the easy one to miss.
    await page.goto("/auth/callback?next=//evil.example.com/path");
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
  });
});
