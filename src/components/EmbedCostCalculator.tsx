"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import {
  competitors,
  competitorMonthlyCost,
  dockaroMonthlyCost,
  formatLoads,
  COMPETITOR_DATA_AS_OF,
} from "@/lib/plans";

/**
 * Discrete steps rather than a linear range input: editor-load volume spans
 * three orders of magnitude, and a linear slider spends 90% of its travel in
 * a region nobody is actually shopping in.
 */
const STEPS = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** Comparison is in USD — the competitors publish USD list prices. */
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export default function EmbedCostCalculator() {
  const [stepIndex, setStepIndex] = useState(4); // 50k loads
  const loads = STEPS[stepIndex];

  const rows = useMemo(() => {
    const ours = dockaroMonthlyCost(loads, "usd");

    const theirs = competitors.map((c) => {
      const cost = competitorMonthlyCost(c, loads);
      const detail =
        cost.total === null
          ? `Past the ${cost.plan.name} tier — enterprise quote`
          : cost.overageBlocks > 0
            ? `${cost.plan.name} + ${cost.overageBlocks.toLocaleString("en-US")} overage blocks @ $${cost.plan.overagePer1k}/1k`
            : `${cost.plan.name} plan`;

      return {
        id: c.id,
        name: c.name,
        total: cost.total,
        detail,
        autoBilled: cost.overageBlocks > 0,
      };
    });

    return {
      ours: {
        name: "DocKaro",
        total: ours.total,
        detail: ours.plan ? `${ours.plan.name} plan` : "Talk to us for a quote",
      },
      theirs,
    };
  }, [loads]);

  // Only claim a saving where both sides have a published number to compare.
  const rivalPrices = rows.theirs
    .map((t) => t.total)
    .filter((t): t is number => t !== null);
  const savings =
    rows.ours.total !== null && rivalPrices.length > 0
      ? Math.min(...rivalPrices) - rows.ours.total
      : null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-lg font-medium">What it costs at your volume</h3>
        <span className="text-sm text-muted">
          <span className="font-medium text-foreground">
            {loads.toLocaleString("en-US")}
          </span>{" "}
          editor loads / month
        </span>
      </div>

      <label htmlFor="loads" className="sr-only">
        Monthly editor loads
      </label>
      <input
        id="loads"
        type="range"
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={stepIndex}
        onChange={(e) => setStepIndex(Number(e.target.value))}
        className="mt-6 w-full accent-[var(--accent)]"
      />
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        {STEPS.map((s, i) => (
          <span key={s} className={clsx(i === stepIndex && "text-foreground")}>
            {formatLoads(s)}
          </span>
        ))}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <CostCard
          name={rows.ours.name}
          total={rows.ours.total}
          detail={rows.ours.detail}
          highlight
        />
        {rows.theirs.map((t) => (
          <CostCard
            key={t.id}
            name={t.name}
            total={t.total}
            detail={t.detail}
            warn={t.autoBilled}
          />
        ))}
      </div>

      {savings !== null && savings > 0 && (
        <p className="mt-6 text-sm text-muted">
          At {loads.toLocaleString("en-US")} loads a month that is{" "}
          <span className="font-medium text-foreground">
            {usd(savings)} less
          </span>{" "}
          than{" "}
          {rivalPrices.length > 1
            ? "the cheaper of the two"
            : "the one still on published pricing"}{" "}
          — {usd(savings * 12)} across a year.
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Competitor figures are published list prices as of {COMPETITOR_DATA_AS_OF},
        billed monthly, and assume the cheapest plan that covers the volume plus
        the per-1,000-load overage their terms describe above it. Negotiated and
        annual rates will differ — check their current pricing pages before you
        make a buying decision on this table.
      </p>
    </div>
  );
}

function CostCard({
  name,
  total,
  detail,
  highlight,
  warn,
}: {
  name: string;
  total: number | null;
  detail: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border p-5",
        highlight ? "border-accent bg-accent/[0.06]" : "border-border bg-background",
      )}
    >
      <p className={clsx("text-sm", highlight ? "text-foreground" : "text-muted")}>
        {name}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">
        {total === null ? "Custom" : usd(total)}
        {total !== null && (
          <span className="ml-1 text-sm font-normal text-muted">/mo</span>
        )}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{detail}</p>
      {warn && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Auto-charged on overage
        </p>
      )}
    </div>
  );
}
