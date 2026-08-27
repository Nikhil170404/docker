import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { razorpayConfig, verifyPaymentSignature } from "@/lib/billing/razorpay";
import { getOrder } from "@/lib/billing/subscription-store";

/**
 * Confirms to the browser that the payment it just made is genuine.
 *
 * Deliberately does NOT grant access — the webhook does that. This exists so
 * the customer sees an honest result immediately instead of staring at a
 * spinner until a webhook lands, and so a forged success callback cannot even
 * produce a convincing screen.
 */
export async function POST(req: NextRequest) {
  if (!razorpayConfig()) {
    return NextResponse.json(
      { error: { code: "billing_unavailable", message: "Billing is not configured." } },
      { status: 503 },
    );
  }

  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in first." } },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const orderId = body?.razorpay_order_id;
  const paymentId = body?.razorpay_payment_id;
  const signature = body?.razorpay_signature;

  if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Missing payment fields." } },
      { status: 400 },
    );
  }

  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    return NextResponse.json(
      { error: { code: "invalid_signature", message: "Signature check failed." } },
      { status: 400 },
    );
  }

  // The signature proves Razorpay produced it; this proves it belongs to the
  // person asking, so one customer cannot confirm another's payment.
  const order = await getOrder(orderId);
  if (!order || order.userId !== user.id) {
    return NextResponse.json(
      { error: { code: "unknown_order", message: "No such order." } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    verified: true,
    planId: order.planId,
    // The webhook is what actually activates; say so rather than implying
    // access is already live.
    activation: order.status === "paid" ? "active" : "pending",
  });
}
