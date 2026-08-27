import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth/session";
import { createApiKey, listApiKeys } from "@/lib/server/api-key-repository";
import { getSubscription } from "@/lib/billing/subscription-store";

/**
 * A customer's API keys.
 *
 * Creation happens here rather than in the browser so the hash is computed
 * somewhere the user cannot influence, and so the plan attached to a key is
 * the plan they have actually paid for rather than one they asked for.
 */

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in first." } },
      { status: 401 },
    );
  }
  return NextResponse.json({ keys: await listApiKeys(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in first." } },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);

  // The plan comes from the subscription, never from the request: a key that
  // granted whatever quota its creator asked for would make the paid tiers
  // decorative.
  const subscription = await getSubscription(user.id);
  const active =
    subscription !== null && new Date(subscription.expiresAt) > new Date();

  const created = await createApiKey({
    ownerId: user.id,
    name: typeof body?.name === "string" ? body.name : undefined,
    planId: active ? subscription!.planId : "embed-free",
  });

  return NextResponse.json(
    {
      // The only time this value ever exists outside the customer's hands.
      secret: created.secret,
      key: created.summary,
      warning: "Copy this key now — it cannot be shown again.",
    },
    { status: 201 },
  );
}
