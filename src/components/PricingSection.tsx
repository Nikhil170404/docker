"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ShieldCheck, Server } from "lucide-react";
import clsx from "clsx";
import {
  suitePlans,
  embedPlans,
  formatLoads,
  formatMoney,
  OVERAGE_POLICY,
  YEARLY_MONTHS_CHARGED,
  type Currency,
  type Period,
} from "@/lib/plans";

type Track = "suite" | "embed";

const tracks: { id: Track; label: string; blurb: string }[] = [
  {
    id: "suite",
    label: "For teams",
    blurb: "Use DocKaro's own Docs and Sheets, priced per account.",
  },
  {
    id: "embed",
    label: "For developers",
    blurb:
      "Embed the editor in your product, priced per editor load — the same unit CKEditor and TinyMCE bill on.",
  },
];

/** Monthly-equivalent price once the yearly discount is applied. */
function shownPrice(raw: number, period: Period) {
  if (raw === 0 || period === "monthly") return raw;
  return Math.round((raw * YEARLY_MONTHS_CHARGED) / 12);
}

export default function PricingSection({
  defaultTrack = "suite",
}: {
  defaultTrack?: Track;
}) {
  const [track, setTrack] = useState<Track>(defaultTrack);
  const [currency, setCurrency] = useState<Currency>("inr");
  const [period, setPeriod] = useState<Period>("monthly");

  const activeTrack = tracks.find((t) => t.id === track)!;

  return (
    <div>
      {/* Track switch */}
      <div className="flex flex-col items-center">
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
          {tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => setTrack(t.id)}
              className={clsx(
                "rounded-md px-5 py-2 transition-colors",
                track === t.id ? "bg-white text-black" : "text-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-4 max-w-md text-center text-sm text-muted">
          {activeTrack.blurb}
        </p>
      </div>

      {/* Period + currency */}
      <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
        <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
          {(["monthly", "yearly"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "rounded-md px-4 py-1.5 capitalize transition-colors",
                period === p ? "bg-white text-black" : "text-muted hover:text-foreground",
              )}
            >
              {p}
              {p === "yearly" && (
                <span className="ml-1.5 text-[10px] text-accent">2 mo free</span>
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
                currency === c ? "bg-white text-black" : "text-muted hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {track === "suite" ? (
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {suitePlans.map((plan) => {
            const raw = plan.price[currency];
            return (
              <PlanCard
                key={plan.id}
                name={plan.name}
                tagline={plan.tagline}
                price={formatMoney(shownPrice(raw, period), currency)}
                unit={plan.unit}
                note={plan.note}
                billedAnnually={period === "yearly" && raw > 0}
                highlight={plan.highlight}
                cta={plan.cta}
                href={plan.href}
                features={plan.features}
              />
            );
          })}
        </div>
      ) : (
        <>
          <div className="mt-10 grid gap-6 lg:grid-cols-4">
            {embedPlans.map((plan) => {
              const raw = plan.price[currency];
              return (
                <PlanCard
                  key={plan.id}
                  name={plan.name}
                  tagline={plan.tagline}
                  price={formatMoney(shownPrice(raw, period), currency)}
                  unit={raw > 0 ? "/mo" : ""}
                  note={plan.note}
                  billedAnnually={period === "yearly" && raw > 0}
                  highlight={plan.highlight}
                  cta={plan.cta}
                  href={plan.href}
                  features={plan.features}
                  badge={
                    plan.loads !== null
                      ? `${formatLoads(plan.loads)} loads / mo`
                      : "Unmetered"
                  }
                />
              );
            })}
          </div>

          {/* The two promises that answer the loudest complaints about
           * CKEditor's and TinyMCE's commercial terms. */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3 rounded-xl border border-border bg-surface p-5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <h4 className="text-sm font-medium">No overage billing</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {OVERAGE_POLICY.summary}
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-xl border border-border bg-surface p-5">
              <Server size={18} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <h4 className="text-sm font-medium">Self-hosting on every tier</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Run the bundle on your own infrastructure from the free tier
                  up. No licence-key banner in the editor, and no sales call
                  standing between you and a self-hosted deployment.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            Embedding at higher volume, or comparing us against a renewal quote?{" "}
            <Link href="/compare" className="text-foreground underline underline-offset-4">
              See the cost side by side
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}

function PlanCard({
  name,
  tagline,
  price,
  unit,
  note,
  billedAnnually,
  highlight,
  cta,
  href,
  features,
  badge,
}: {
  name: string;
  tagline: string;
  price: string;
  unit: string;
  note?: string;
  billedAnnually: boolean;
  highlight?: boolean;
  cta: string;
  href: string;
  features: string[];
  badge?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col rounded-2xl border p-7",
        highlight
          ? "border-accent bg-accent/[0.06] ring-1 ring-accent"
          : "border-border bg-surface",
      )}
    >
      {highlight && (
        <span className="mb-3 w-fit rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
          Most popular
        </span>
      )}
      <h3 className="text-lg font-medium">{name}</h3>
      <p className="mt-1 text-sm text-muted">{tagline}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">{price}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {badge && (
        <span className="mt-3 w-fit rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted">
          {badge}
        </span>
      )}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
      {billedAnnually && <p className="mt-1 text-xs text-muted">billed annually</p>}

      <Link
        href={href}
        className={clsx(
          "mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-90",
          highlight ? "bg-white text-black" : "border border-border text-foreground",
        )}
      >
        {cta}
      </Link>

      <ul className="mt-7 space-y-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-muted">
            <Check size={16} className="mt-0.5 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
