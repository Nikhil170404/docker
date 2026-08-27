import { createHmac, timingSafeEqual } from "node:crypto";
import type { Currency } from "@/lib/plans";

/**
 * Razorpay, over its REST API rather than the SDK.
 *
 * The SDK is a thin wrapper over these two calls plus an HMAC, and doing it
 * directly keeps the signature verification — the only part where a mistake
 * costs money — as plain, testable code rather than something delegated to a
 * dependency.
 *
 * One gateway for both markets: Razorpay settles Indian payments in INR with
 * UPI, netbanking, cards and wallets, and takes international cards in USD
 * once international payments are enabled on the account. Two gateways would
 * mean two reconciliations and two webhook paths for one product.
 */

const API_BASE = "https://api.razorpay.com/v1";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/**
 * Credentials come from the environment and are read per call, so a
 * deployment can rotate them without a rebuild — and so tests can drive this
 * module without a live account.
 */
export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}

/** The publishable key the browser checkout needs. Safe to expose. */
export function publishableKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID ?? null;
}

export const isBillingConfigured = () => razorpayConfig() !== null;

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export interface CreateOrderInput {
  /** Smallest currency unit — paise for INR, cents for USD. */
  amountMinor: number;
  currency: Currency;
  /** Our own reference, echoed back on the webhook. */
  receipt: string;
  notes: Record<string, string>;
}

export async function createOrder(
  input: CreateOrderInput,
  config = razorpayConfig(),
): Promise<RazorpayOrder> {
  if (!config) {
    throw new RazorpayError("Billing is not configured on this deployment.", 503);
  }

  const response = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${config.keyId}:${config.keySecret}`,
      ).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency.toUpperCase(),
      receipt: input.receipt,
      notes: input.notes,
      // Capture automatically: a manual capture that nobody wrote a cron for
      // is how authorised payments silently expire after five days.
      payment_capture: 1,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new RazorpayError(
      `Razorpay rejected the order (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  return (await response.json()) as RazorpayOrder;
}

/* ------------------------------------------------------------------ */
/* Signatures                                                          */
/* ------------------------------------------------------------------ */

/** Constant-time compare over hex digests of possibly differing length. */
function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself leak the
  // length, so the lengths are compared first and the result is still run
  // through a constant-time compare for equal-length inputs.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verifies the signature Razorpay's checkout hands back to the browser.
 *
 * This is what stops a customer opening devtools and posting a made-up
 * payment id: only someone holding the key secret can produce the HMAC over
 * `order_id|payment_id`.
 */
export function verifyPaymentSignature(
  input: { orderId: string; paymentId: string; signature: string },
  config = razorpayConfig(),
): boolean {
  if (!config) return false;
  if (!input.orderId || !input.paymentId || !input.signature) return false;

  const expected = createHmac("sha256", config.keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");

  return signaturesMatch(expected, input.signature);
}

/**
 * Verifies a webhook body against the webhook secret, which is a different
 * secret from the API key — using the wrong one here is the classic way to
 * end up accepting forged webhooks.
 *
 * The raw body must be the exact bytes received: re-serialising parsed JSON
 * changes key order and whitespace, and the HMAC with it.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  config = razorpayConfig(),
): boolean {
  if (!config || !signature) return false;

  const expected = createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex");

  return signaturesMatch(expected, signature);
}

/* ------------------------------------------------------------------ */
/* Webhook payloads                                                    */
/* ------------------------------------------------------------------ */

export interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string; amount: number; currency: string; status: string; notes?: Record<string, string> } };
    order?: { entity: { id: string; amount: number; currency: string; receipt?: string; notes?: Record<string, string> } };
  };
}

/** Events worth acting on. Anything else is acknowledged and ignored. */
export const HANDLED_WEBHOOK_EVENTS = [
  "payment.captured",
  "payment.failed",
  "order.paid",
] as const;

export function isHandledEvent(event: string): boolean {
  return (HANDLED_WEBHOOK_EVENTS as readonly string[]).includes(event);
}
