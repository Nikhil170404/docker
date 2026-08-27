import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { getSubscription, listOrders } from "@/lib/billing/subscription-store";

/** The signed-in customer's current plan and payment history. */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in first." } },
      { status: 401 },
    );
  }

  const subscription = await getSubscription(user.id);
  const active =
    subscription !== null && new Date(subscription.expiresAt) > new Date();

  return NextResponse.json({
    subscription,
    active,
    orders: await listOrders(user.id),
  });
}
