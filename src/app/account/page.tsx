import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SignOutButton from "@/components/auth/SignOutButton";
import { currentUser } from "@/lib/auth/session";
import { isAuthConfigured } from "@/lib/auth/supabase";
import { getSubscription, listOrders } from "@/lib/billing/subscription-store";
import { findBillablePlan } from "@/lib/billing/pricing";
import { formatMoney } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = isAuthConfigured() ? await currentUser() : null;

  if (!user) {
    return (
      <>
        <Navbar />
        <main className="flex flex-1 items-center justify-center px-6 py-24">
          <div className="max-w-sm text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Not signed in</h1>
            <p className="mt-3 text-sm text-muted">
              {isAuthConfigured()
                ? "Sign in to see your plan and payment history."
                : "Accounts are not configured on this deployment."}
            </p>
            {isAuthConfigured() && (
              <Link
                href="/signin"
                className="mt-6 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black"
              >
                Sign in
              </Link>
            )}
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const subscription = await getSubscription(user.id);
  const orders = await listOrders(user.id);
  const active = subscription && new Date(subscription.expiresAt) > new Date();
  const plan = subscription ? findBillablePlan(subscription.planId) : null;

  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20">
        <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
        <p className="mt-2 text-sm text-muted">{user.email}</p>

        <section className="mt-10 rounded-2xl border border-border bg-surface p-7">
          <h2 className="text-lg font-medium">Plan</h2>
          {active && subscription ? (
            <div className="mt-3 text-sm text-muted">
              <p>
                <span className="text-foreground">{plan?.name ?? subscription.planId}</span>{" "}
                · billed {subscription.period}
                {subscription.seats > 1 ? ` · ${subscription.seats} seats` : ""}
              </p>
              <p className="mt-1">
                Renews {new Date(subscription.expiresAt).toLocaleDateString()}
              </p>
            </div>
          ) : (
            <div className="mt-3 text-sm text-muted">
              <p>You are on the Free plan.</p>
              <Link href="/pricing" className="mt-3 inline-block text-foreground underline underline-offset-4">
                See plans
              </Link>
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-border bg-surface p-7">
          <h2 className="text-lg font-medium">Payments</h2>
          {orders.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No payments yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border text-sm">
              {orders.map((order) => (
                <li key={order.orderId} className="flex items-center justify-between py-3">
                  <span className="text-muted">
                    {new Date(order.createdAt).toLocaleDateString()} ·{" "}
                    {findBillablePlan(order.planId)?.name ?? order.planId}
                  </span>
                  <span className="flex items-center gap-3">
                    <span>{formatMoney(order.amountMinor / 100, order.currency)}</span>
                    <span
                      className={
                        order.status === "paid"
                          ? "text-accent"
                          : order.status === "failed"
                            ? "text-red-400"
                            : "text-muted"
                      }
                    >
                      {order.status}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8">
          <SignOutButton />
        </div>
      </main>
      <Footer />
    </>
  );
}
