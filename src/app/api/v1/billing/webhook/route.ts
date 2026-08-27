import { NextRequest, NextResponse } from "next/server";
import {
  isHandledEvent,
  razorpayConfig,
  verifyWebhookSignature,
  type RazorpayWebhookEvent,
} from "@/lib/billing/razorpay";
import {
  activateSubscription,
  getOrder,
  markOrder,
} from "@/lib/billing/subscription-store";

/**
 * Razorpay's webhook — the only thing that grants paid access.
 *
 * The browser's success callback is a convenience for showing the customer a
 * receipt; it is not evidence. A payment is real when Razorpay says so over a
 * signed server-to-server call, which is what this is.
 */

export async function POST(req: NextRequest) {
  if (!razorpayConfig()) {
    return NextResponse.json(
      { error: { code: "billing_unavailable", message: "Billing is not configured." } },
      { status: 503 },
    );
  }

  // The raw bytes, not a re-serialised object: the HMAC covers exactly what
  // was sent, and JSON.stringify(JSON.parse(x)) is very often not x.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    // No detail in the response: a forger should learn nothing from it.
    return NextResponse.json(
      { error: { code: "invalid_signature", message: "Signature check failed." } },
      { status: 401 },
    );
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(raw) as RazorpayWebhookEvent;
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  // Anything we do not act on is acknowledged anyway, so Razorpay stops
  // retrying an event that will never mean anything to us.
  if (!isHandledEvent(event.event)) {
    return NextResponse.json({ received: true, handled: false });
  }

  const payment = event.payload.payment?.entity;
  const orderId = payment?.order_id ?? event.payload.order?.entity.id;
  if (!orderId) {
    return NextResponse.json({ received: true, handled: false });
  }

  // An order we never created cannot be paid for. This is the check that a
  // valid signature alone would not give us — it ties the payment back to a
  // plan and a user we chose, at an amount we computed.
  const order = await getOrder(orderId);
  if (!order) {
    return NextResponse.json(
      { error: { code: "unknown_order", message: "No such order." } },
      { status: 404 },
    );
  }

  if (event.event === "payment.failed") {
    await markOrder(orderId, "failed", payment?.id);
    return NextResponse.json({ received: true, handled: true, status: "failed" });
  }

  // The amount is checked against what we asked for, so a tampered or
  // partial capture cannot buy a plan it did not pay for.
  if (payment && payment.amount !== order.amountMinor) {
    return NextResponse.json(
      {
        error: {
          code: "amount_mismatch",
          message: "Captured amount does not match the order.",
        },
      },
      { status: 409 },
    );
  }

  // Razorpay retries until it gets a 2xx, so the same capture arrives more
  // than once. markOrder keeps "paid" terminal and activateSubscription
  // extends from the existing expiry, so a repeat is a no-op rather than a
  // second month of free access.
  const alreadyPaid = order.status === "paid";
  const updated = await markOrder(orderId, "paid", payment?.id);
  if (!updated) {
    return NextResponse.json(
      { error: { code: "unknown_order", message: "No such order." } },
      { status: 404 },
    );
  }

  if (!alreadyPaid) {
    await activateSubscription(updated);
  }

  return NextResponse.json({
    received: true,
    handled: true,
    status: "paid",
    duplicate: alreadyPaid,
  });
}
