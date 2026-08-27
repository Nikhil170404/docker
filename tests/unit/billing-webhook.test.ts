import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const BILLING_DIR = mkdtempSync(join(tmpdir(), "dockaro-billing-"));
process.env.DOCKARO_BILLING_DIR = BILLING_DIR;
process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "key_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "webhook_secret";

const { POST } = await import("@/app/api/v1/billing/webhook/route");
const store = await import("@/lib/billing/subscription-store");

const USER = "user-abc";
const ORDER_ID = "order_TEST123";
const AMOUNT = 2_900;

function webhookRequest(body: unknown, secret = "webhook_secret") {
  const raw = JSON.stringify(body);
  return new NextRequest("http://localhost/api/v1/billing/webhook", {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
      "x-razorpay-signature": createHmac("sha256", secret).update(raw).digest("hex"),
    }),
    body: raw,
  });
}

const captured = (overrides: Record<string, unknown> = {}) => ({
  event: "payment.captured",
  payload: {
    payment: {
      entity: {
        id: "pay_TEST999",
        order_id: ORDER_ID,
        amount: AMOUNT,
        currency: "USD",
        status: "captured",
        ...overrides,
      },
    },
  },
});

async function seedOrder() {
  return store.recordOrder({
    orderId: ORDER_ID,
    userId: USER,
    planId: "embed-starter",
    currency: "usd",
    period: "monthly",
    seats: 1,
    amountMinor: AMOUNT,
  });
}

beforeEach(() => {
  rmSync(BILLING_DIR, { recursive: true, force: true });
});

afterAll(() => rmSync(BILLING_DIR, { recursive: true, force: true }));

describe("signature enforcement", () => {
  it("refuses a body signed with the wrong secret", async () => {
    await seedOrder();
    const res = await POST(webhookRequest(captured(), "attacker_secret"));
    expect(res.status).toBe(401);
    // Nothing may be granted from an unverified call.
    expect(await store.hasActiveSubscription(USER)).toBe(false);
  });

  it("refuses a body with no signature at all", async () => {
    await seedOrder();
    const raw = JSON.stringify(captured());
    const res = await POST(
      new NextRequest("http://localhost/api/v1/billing/webhook", {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: raw,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("says nothing useful to a forger", async () => {
    const res = await POST(webhookRequest(captured(), "attacker_secret"));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/secret|expected|hmac/i);
  });
});

describe("order matching", () => {
  it("rejects a payment for an order nobody created", async () => {
    // A valid signature is not enough: the order has to be one we opened,
    // at an amount we computed, for a user we know.
    const res = await POST(webhookRequest(captured()));
    expect(res.status).toBe(404);
  });

  it("rejects a captured amount that does not match the order", async () => {
    await seedOrder();
    const res = await POST(webhookRequest(captured({ amount: 100 })));
    expect(res.status).toBe(409);
    expect(await store.hasActiveSubscription(USER)).toBe(false);
  });
});

describe("granting access", () => {
  it("activates a subscription on a verified capture", async () => {
    await seedOrder();
    const res = await POST(webhookRequest(captured()));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("paid");

    const subscription = await store.getSubscription(USER);
    expect(subscription!.planId).toBe("embed-starter");
    expect(await store.hasActiveSubscription(USER)).toBe(true);
  });

  it("marks the order paid and records the payment id", async () => {
    await seedOrder();
    await POST(webhookRequest(captured()));
    const order = await store.getOrder(ORDER_ID);
    expect(order!.status).toBe("paid");
    expect(order!.paymentId).toBe("pay_TEST999");
  });

  it("is idempotent — Razorpay retries until it gets a 2xx", async () => {
    await seedOrder();
    await POST(webhookRequest(captured()));
    const first = await store.getSubscription(USER);

    const replay = await POST(webhookRequest(captured()));
    expect(replay.status).toBe(200);
    expect((await replay.json()).duplicate).toBe(true);

    // A replayed capture must not buy a second month.
    const second = await store.getSubscription(USER);
    expect(second!.expiresAt).toBe(first!.expiresAt);
  });

  it("records a failure without granting anything", async () => {
    await seedOrder();
    const res = await POST(
      webhookRequest({
        event: "payment.failed",
        payload: { payment: { entity: { id: "pay_F", order_id: ORDER_ID, amount: AMOUNT, currency: "USD", status: "failed" } } },
      }),
    );
    expect(res.status).toBe(200);
    expect((await store.getOrder(ORDER_ID))!.status).toBe("failed");
    expect(await store.hasActiveSubscription(USER)).toBe(false);
  });

  it("cannot un-pay an order with a late failure", async () => {
    await seedOrder();
    await POST(webhookRequest(captured()));
    await POST(
      webhookRequest({
        event: "payment.failed",
        payload: { payment: { entity: { id: "pay_F", order_id: ORDER_ID, amount: AMOUNT, currency: "USD", status: "failed" } } },
      }),
    );
    expect((await store.getOrder(ORDER_ID))!.status).toBe("paid");
    expect(await store.hasActiveSubscription(USER)).toBe(true);
  });
});

describe("events we do not act on", () => {
  it("acknowledges them so Razorpay stops retrying", async () => {
    const res = await POST(
      webhookRequest({ event: "refund.created", payload: {} }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).handled).toBe(false);
  });
});

describe("subscription arithmetic", () => {
  it("adds a month for a monthly plan and a year for a yearly one", () => {
    const start = new Date("2026-01-15T00:00:00.000Z");
    expect(store.periodEnd(start, "monthly").toISOString()).toContain("2026-02-15");
    expect(store.periodEnd(start, "yearly").toISOString()).toContain("2027-01-15");
  });

  it("stacks an early renewal onto the time already bought", async () => {
    const order = await seedOrder();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = await store.activateSubscription(order, now);

    // Renewing a fortnight in must not throw the remaining fortnight away.
    const midway = new Date("2026-01-15T00:00:00.000Z");
    const second = await store.activateSubscription(order, midway);
    expect(new Date(second.expiresAt).getTime()).toBeGreaterThan(
      new Date(first.expiresAt).getTime(),
    );
    expect(second.startedAt).toBe(first.startedAt);
  });

  it("treats a lapsed subscription as starting fresh", async () => {
    const order = await seedOrder();
    await store.activateSubscription(order, new Date("2026-01-01T00:00:00.000Z"));

    const muchLater = new Date("2026-06-01T00:00:00.000Z");
    const renewed = await store.activateSubscription(order, muchLater);
    expect(renewed.expiresAt).toBe(
      store.periodEnd(muchLater, "monthly").toISOString(),
    );
  });

  it("refuses identifiers that could escape the billing directory", async () => {
    expect(await store.getOrder("../../etc/passwd")).toBeNull();
    expect(await store.getSubscription("../secrets")).toBeNull();
  });
});
