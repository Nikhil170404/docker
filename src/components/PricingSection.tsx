"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import clsx from "clsx";

type Currency = "inr" | "usd";
type Period = "monthly" | "yearly";

const plans = [
  {
    id: "free",
    name: "Free",
    tagline: "Try before you commit",
    price: { inr: 0, usd: 0 },
    unit: "",
    cta: "Start free",
    href: "/signup",
    highlight: false,
    features: [
      "Docs + Sheets editor (unlimited)",
      "100 mail merge sends / month",
      "ILPA quick-start templates",
      "PDF export (with watermark)",
      "Community support",
    ],
    notIncluded: ["LP investor portal", "E-signatures", "Open tracking", "API access"],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "For seed & early-stage funds",
    price: { inr: 3999, usd: 49 },
    unit: "/mo",
    cta: "Start 14-day trial",
    href: "/signup",
    highlight: false,
    badge: null,
    features: [
      "Everything in Free",
      "1,000 sends / month",
      "LP portal — up to 30 LPs",
      "E-signatures — 10 / month",
      "Open tracking & read receipts",
      "Scheduled sends",
      "No watermark on PDF export",
      "Email support",
    ],
    notIncluded: ["API access", "Custom sender domain"],
  },
  {
    id: "fund",
    name: "Fund",
    tagline: "For established VCs, AIFs & family offices",
    price: { inr: 9999, usd: 119 },
    unit: "/mo",
    cta: "Start 14-day trial",
    href: "/signup",
    highlight: true,
    badge: "Most popular",
    features: [
      "Everything in Starter",
      "10,000 sends / month",
      "Unlimited LP portals",
      "Unlimited e-signatures",
      "API access — 5,000 calls / month",
      "Custom sender domain",
      "Scheduled bulk sends",
      "Priority support (< 4 hr response)",
    ],
    notIncluded: [],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Large funds & fund of funds",
    price: { inr: 24999, usd: 299 },
    unit: "/mo",
    cta: "Talk to us",
    href: "mailto:hello@dockaro.com?subject=DocKaro%20Enterprise",
    highlight: false,
    badge: null,
    features: [
      "Everything in Fund",
      "Unlimited sends",
      "Unlimited API calls",
      "White-label LP portal",
      "Custom domain for portal",
      "Dedicated account manager",
      "99.9% uptime SLA",
      "Custom ILPA templates",
    ],
    notIncluded: [],
  },
];

const savings = [
  { tool: "Mailchimp Pro (5k contacts)", cost: "₹22,000" },
  { tool: "DocuSign Business (5 users)", cost: "₹18,000" },
  { tool: "LP portal software", cost: "₹40,000–80,000" },
  { tool: "Microsoft 365 (5 users)", cost: "₹10,000" },
];

const fmt = (n: number, currency: Currency) =>
  n === 0 ? "Free" : currency === "inr" ? `₹${n.toLocaleString("en-IN")}` : `$${n}`;

export default function PricingSection() {
  const [currency, setCurrency] = useState<Currency>("inr");
  const [period, setPeriod] = useState<Period>("monthly");

  return (
    <div>
      {/* Toggles */}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-5">
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
          {(["monthly", "yearly"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "rounded-md px-4 py-1.5 capitalize transition-colors",
                period === p ? "bg-white text-black" : "text-muted hover:text-foreground"
              )}
            >
              {p}
              {p === "yearly" && (
                <span className="ml-1.5 text-[10px] font-semibold text-accent">2 mo free</span>
              )}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
          {(["inr", "usd"] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={clsx(
                "rounded-md px-4 py-1.5 uppercase transition-colors",
                currency === c ? "bg-white text-black" : "text-muted hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Plans */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const raw = plan.price[currency];
          const shown =
            period === "yearly" && raw > 0 ? Math.round((raw * 10) / 12) : raw;

          return (
            <div
              key={plan.id}
              className={clsx(
                "flex flex-col rounded-2xl border p-6",
                plan.highlight
                  ? "border-accent bg-accent/[0.06] ring-1 ring-accent"
                  : "border-border bg-surface"
              )}
            >
              {plan.badge && (
                <span className="mb-3 w-fit rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {plan.badge}
                </span>
              )}
              <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
              <p className="mt-1 text-xs text-muted">{plan.tagline}</p>

              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-foreground">
                  {fmt(shown, currency)}
                </span>
                {raw > 0 && (
                  <span className="text-sm text-muted">{plan.unit}</span>
                )}
              </div>
              {period === "yearly" && raw > 0 && (
                <p className="mt-0.5 text-xs text-muted">billed annually · save 2 months</p>
              )}

              <Link
                href={plan.href}
                className={clsx(
                  "mt-5 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90",
                  plan.highlight
                    ? "bg-white text-black"
                    : "border border-border text-foreground hover:bg-white/5"
                )}
              >
                {plan.cta}
              </Link>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted">
                    <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Savings comparison */}
      <div className="mt-14 rounded-2xl border border-border bg-surface/60 p-7 sm:p-9">
        <div className="mb-6 text-center">
          <h3 className="text-lg font-semibold text-foreground">What fund managers pay today — buying separately</h3>
          <p className="mt-1.5 text-sm text-muted">DocKaro Fund replaces all of this. At a fraction of the cost.</p>
        </div>
        <div className="mx-auto max-w-lg divide-y divide-border overflow-hidden rounded-xl border border-border">
          {savings.map((s) => (
            <div key={s.tool} className="flex items-center justify-between px-5 py-3.5">
              <span className="text-sm text-muted">{s.tool}</span>
              <span className="text-sm font-semibold text-foreground">{s.cost}<span className="text-xs text-muted font-normal">/mo</span></span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-red-500/5 px-5 py-4">
            <span className="text-sm font-semibold text-foreground">Total monthly spend</span>
            <span className="text-base font-bold text-red-400">₹90,000 – 1,30,000/mo</span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          <ArrowRight size={16} className="text-muted" />
          <span className="text-sm text-muted">DocKaro Fund replaces all of it for</span>
          <span className="rounded-lg bg-accent/10 px-3 py-1 text-sm font-bold text-accent">₹9,999/month</span>
        </div>
        <p className="mt-3 text-center text-xs text-muted">
          That&apos;s less than the cost of Mailchimp alone. E-signatures, LP portal, mail merge, open tracking — all included.
        </p>
      </div>

      {/* Enterprise CTA */}
      <div className="mt-10 rounded-xl border border-border bg-surface p-7 text-center">
        <h3 className="font-semibold text-foreground">Large fund or fund of funds?</h3>
        <p className="mt-2 text-sm text-muted">
          We offer custom white-label portals, unlimited sends, dedicated onboarding, and an SLA for funds with 200+ LPs.
        </p>
        <Link
          href="mailto:hello@dockaro.com?subject=DocKaro%20Enterprise"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Talk to us <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
