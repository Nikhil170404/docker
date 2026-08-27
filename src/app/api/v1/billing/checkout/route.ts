import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/auth/supabase";
import {
  BillingError,
  currencyForRegion,
  isSupportedCurrency,
  isSupportedPeriod,
  resolveCheckoutAmount,
} from "@/lib/billing/pricing";
import {
  createOrder,
  publishableKeyId,
  RazorpayError,
  razorpayConfig,
} from "@/lib/billing/razorpay";
import { recordOrder } from "@/lib/billing/subscription-store";

/**
 * Opens a checkout.
 *
 * The amount is computed here from the plan id, never taken from the client.
 * A price posted by the browser is a price the browser can edit, and this is
 * the request that decides what a customer is charged.
 */
export async function POST(req: NextRequest) {
  if (!isAuthConfigured() || !razorpayConfig()) {
    return NextResponse.json(
      {
        error: {
          code: "billing_unavailable",
          message:
            "Billing is not configured on this deployment. Set the Supabase and Razorpay environment variables.",
        },
      },
      { status: 503 },
    );
  }

  // Checkout is tied to an account: a payment with nobody to grant access to
  // is money taken for nothing.
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in before subscribing." } },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.planId !== "string") {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Expected { planId }." } },
      { status: 400 },
    );
  }

  // The customer's explicit choice wins; the edge header is only a default,
  // because geo is a guess and travellers exist.
  const currency = isSupportedCurrency(body.currency)
    ? body.currency
    : currencyForRegion(req.headers.get("x-vercel-ip-country"));
  const period = isSupportedPeriod(body.period) ? body.period : "monthly";

  try {
    const amount = resolveCheckoutAmount({
      planId: body.planId,
      currency,
      period,
      seats: typeof body.seats === "number" ? body.seats : undefined,
    });

    const receipt = `rcpt_${Date.now().toString(36)}_${user.id.slice(0, 8)}`;
    const order = await createOrder({
      amountMinor: amount.minor,
      currency: amount.currency,
      receipt,
      // Echoed back on the webhook, so a payment can be traced to a plan even
      // if our own record were somehow missing.
      notes: {
        userId: user.id,
        planId: amount.plan.id,
        period: amount.period,
        seats: String(amount.seats),
      },
    });

    // Recorded before the customer ever sees the checkout: a webhook for an
    // order we did not create is a forgery, and this is what makes that
    // detectable.
    await recordOrder({
      orderId: order.id,
      userId: user.id,
      planId: amount.plan.id,
      currency: amount.currency,
      period: amount.period,
      seats: amount.seats,
      amountMinor: amount.minor,
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: publishableKeyId(),
      description: amount.description,
      customerEmail: user.email,
    });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof RazorpayError) {
      return NextResponse.json(
        { error: { code: "gateway_error", message: error.message } },
        { status: 502 },
      );
    }
    throw error;
  }
}
