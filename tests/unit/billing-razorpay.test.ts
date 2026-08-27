import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  isBillingConfigured,
  isHandledEvent,
  publishableKeyId,
  razorpayConfig,
  RazorpayError,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "@/lib/billing/razorpay";

const KEY_ID = "rzp_test_key_id";
const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "test_webhook_secret";

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe("configuration", () => {
  it("reports configured only when all three secrets are present", () => {
    expect(isBillingConfigured()).toBe(true);
    expect(publishableKeyId()).toBe(KEY_ID);

    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    // A deployment with no webhook secret cannot verify a payment, so it is
    // not configured — accepting orders there would take money it could
    // never confirm.
    expect(isBillingConfigured()).toBe(false);
    expect(razorpayConfig()).toBeNull();
  });

  it("refuses to create an order when unconfigured", async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    await expect(
      createOrder({ amountMinor: 2900, currency: "usd", receipt: "r1", notes: {} }),
    ).rejects.toBeInstanceOf(RazorpayError);
  });
});

describe("verifyPaymentSignature", () => {
  const orderId = "order_ABC123";
  const paymentId = "pay_XYZ789";
  const valid = () => sign(KEY_SECRET, `${orderId}|${paymentId}`);

  it("accepts a signature made with the key secret", () => {
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: valid() }),
    ).toBe(true);
  });

  it("rejects a signature over different values", () => {
    // This is the attack it exists to stop: a customer editing the payment id
    // in devtools and posting a success they never paid for.
    expect(
      verifyPaymentSignature({
        orderId,
        paymentId: "pay_FORGED",
        signature: valid(),
      }),
    ).toBe(false);
    expect(
      verifyPaymentSignature({
        orderId: "order_OTHER",
        paymentId,
        signature: valid(),
      }),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const forged = sign("not_the_secret", `${orderId}|${paymentId}`);
    expect(verifyPaymentSignature({ orderId, paymentId, signature: forged })).toBe(false);
  });

  it("rejects the webhook secret being used as the payment secret", () => {
    // The two secrets are different values for different purposes; mixing
    // them up is the classic way to accept forgeries.
    const wrongSecret = sign(WEBHOOK_SECRET, `${orderId}|${paymentId}`);
    expect(
      verifyPaymentSignature({ orderId, paymentId, signature: wrongSecret }),
    ).toBe(false);
  });

  it("rejects empty, truncated and oversized signatures", () => {
    const good = valid();
    for (const signature of ["", good.slice(0, -1), `${good}00`, "not-hex"]) {
      expect(verifyPaymentSignature({ orderId, paymentId, signature })).toBe(false);
    }
  });

  it("rejects missing fields rather than throwing", () => {
    expect(verifyPaymentSignature({ orderId: "", paymentId, signature: valid() })).toBe(false);
    expect(verifyPaymentSignature({ orderId, paymentId: "", signature: valid() })).toBe(false);
  });

  it("verifies nothing when the deployment is unconfigured", () => {
    const signature = valid();
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(verifyPaymentSignature({ orderId, paymentId, signature })).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });

  it("accepts a body signed with the webhook secret", () => {
    expect(verifyWebhookSignature(body, sign(WEBHOOK_SECRET, body))).toBe(true);
  });

  it("rejects a body signed with the API key secret", () => {
    expect(verifyWebhookSignature(body, sign(KEY_SECRET, body))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const signature = sign(WEBHOOK_SECRET, body);
    const tampered = JSON.stringify({ event: "payment.captured", payload: { x: 1 } });
    expect(verifyWebhookSignature(tampered, signature)).toBe(false);
  });

  it("is sensitive to whitespace, which is why the raw body is used", () => {
    // Re-serialising parsed JSON changes bytes and breaks the HMAC — the
    // reason the route reads req.text() rather than req.json().
    const signature = sign(WEBHOOK_SECRET, body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyWebhookSignature(reserialised, signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature(body, "")).toBe(false);
  });
});

describe("handled events", () => {
  it("acts on captures, failures and paid orders", () => {
    expect(isHandledEvent("payment.captured")).toBe(true);
    expect(isHandledEvent("payment.failed")).toBe(true);
    expect(isHandledEvent("order.paid")).toBe(true);
  });

  it("ignores everything else", () => {
    for (const event of ["subscription.charged", "refund.created", "", "payment"]) {
      expect(isHandledEvent(event)).toBe(false);
    }
  });
});
