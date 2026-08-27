"use client";

import { useCallback, useState } from "react";
import clsx from "clsx";
import type { Currency, Period } from "@/lib/plans";

/**
 * Drives Razorpay's hosted checkout.
 *
 * The amount is never passed from here — the server computes it from the plan
 * id and hands back an order. This component only opens the modal Razorpay
 * gives us for that order, so there is nothing on this side worth tampering
 * with.
 */

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { email?: string };
  theme?: { color?: string };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

/** Loads Razorpay's script once, however many buttons are on the page. */
let scriptPromise: Promise<boolean> | null = null;
function loadCheckoutScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  scriptPromise ??= new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.onload = () => resolve(true);
    script.onerror = () => {
      scriptPromise = null; // Let a later attempt retry.
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export type CheckoutState =
  | "idle"
  | "opening"
  | "verifying"
  | "success"
  | "signin-required"
  | "unavailable"
  | "error";

export default function CheckoutButton({
  planId,
  currency,
  period,
  seats,
  label,
  highlight,
}: {
  planId: string;
  currency: Currency;
  period: Period;
  seats?: number;
  label: string;
  highlight?: boolean;
}) {
  const [state, setState] = useState<CheckoutState>("idle");
  const [message, setMessage] = useState("");

  const start = useCallback(async () => {
    setState("opening");
    setMessage("");

    try {
      const response = await fetch("/api/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, currency, period, seats }),
      });

      if (response.status === 401) {
        setState("signin-required");
        return;
      }
      if (response.status === 503) {
        setState("unavailable");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setState("error");
        setMessage(body?.error?.message ?? "Could not start checkout.");
        return;
      }

      const order = await response.json();
      if (!(await loadCheckoutScript()) || !window.Razorpay) {
        setState("error");
        setMessage("Could not reach Razorpay. Check your connection and retry.");
        return;
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "DocKaro",
        description: order.description,
        prefill: order.customerEmail ? { email: order.customerEmail } : undefined,
        theme: { color: "#6366f1" },
        handler: async (result) => {
          setState("verifying");
          const verified = await fetch("/api/v1/billing/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result),
          });

          if (!verified.ok) {
            setState("error");
            setMessage("We could not verify that payment. Nothing was charged twice — contact support with your payment id.");
            return;
          }
          setState("success");
        },
        modal: {
          // Closing the modal is not a failure; it is a customer changing
          // their mind, and the button should simply be usable again.
          ondismiss: () => setState((current) => (current === "opening" ? "idle" : current)),
        },
      });
      checkout.open();
    } catch {
      setState("error");
      setMessage("Something went wrong starting checkout.");
    }
  }, [planId, currency, period, seats]);

  if (state === "success") {
    return (
      <p
        data-testid="checkout-success"
        className="mt-6 rounded-lg border border-accent/40 bg-accent/[0.06] px-4 py-2.5 text-center text-sm"
      >
        Payment received — activating your plan.
      </p>
    );
  }

  if (state === "signin-required") {
    return (
      <a
        href="/signin"
        data-testid="checkout-signin"
        className="mt-6 block rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium"
      >
        Sign in to subscribe
      </a>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={start}
        disabled={state === "opening" || state === "verifying"}
        data-testid={`checkout-${planId}`}
        className={clsx(
          "w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60",
          highlight ? "bg-white text-black" : "border border-border text-foreground",
        )}
      >
        {state === "opening" ? "Opening…" : state === "verifying" ? "Confirming…" : label}
      </button>

      {state === "unavailable" && (
        <p data-testid="checkout-unavailable" className="mt-2 text-xs text-muted">
          Payments are not enabled on this deployment yet.
        </p>
      )}
      {state === "error" && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {message}
        </p>
      )}
    </div>
  );
}
