import { describe, expect, it } from "vitest";
import {
  competitorMonthlyCost,
  competitors,
  dockaroMonthlyCost,
  embedPlans,
  formatLoads,
  formatMoney,
  OVERAGE_POLICY,
  suitePlans,
  YEARLY_MONTHS_CHARGED,
} from "@/lib/plans";

const ck = competitors.find((c) => c.id === "ckeditor")!;
const tiny = competitors.find((c) => c.id === "tinymce")!;

describe("plan data integrity", () => {
  it("orders embed tiers by ascending price and included loads", () => {
    const paid = embedPlans.filter((p) => p.price.usd > 0);
    const prices = paid.map((p) => p.price.usd);
    const loads = paid.map((p) => p.loads ?? Infinity);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(loads).toEqual([...loads].sort((a, b) => a - b));
  });

  it("beats both rivals' free tiers on included loads", () => {
    const free = embedPlans.find((p) => p.id === "embed-free")!;
    for (const rival of competitors) {
      expect(free.loads!).toBeGreaterThan(rival.plans[0].loads);
    }
  });

  it("never auto-bills on overage, which the pricing page states verbatim", () => {
    expect(OVERAGE_POLICY.autoBilled).toBe(false);
    expect(OVERAGE_POLICY.hardBlock).toBe(false);
    expect(OVERAGE_POLICY.graceMultiplier).toBeGreaterThan(1);
  });

  it("gives every plan the fields the pricing cards render", () => {
    for (const plan of [...embedPlans, ...suitePlans]) {
      expect(plan.name).toBeTruthy();
      expect(plan.tagline).toBeTruthy();
      expect(plan.cta).toBeTruthy();
      expect(plan.href).toMatch(/^\//);
      expect(plan.features.length).toBeGreaterThan(0);
      expect(plan.price.inr).toBeGreaterThanOrEqual(0);
      expect(plan.price.usd).toBeGreaterThanOrEqual(0);
    }
  });

  it("discounts a year to ten months, not twelve", () => {
    expect(YEARLY_MONTHS_CHARGED).toBe(10);
  });
});

describe("dockaroMonthlyCost", () => {
  it("puts a volume on the cheapest tier that covers it", () => {
    expect(dockaroMonthlyCost(1_000, "usd").plan?.id).toBe("embed-free");
    expect(dockaroMonthlyCost(5_000, "usd").plan?.id).toBe("embed-free");
    expect(dockaroMonthlyCost(5_001, "usd").plan?.id).toBe("embed-starter");
    expect(dockaroMonthlyCost(50_000, "usd").plan?.id).toBe("embed-starter");
    expect(dockaroMonthlyCost(50_001, "usd").plan?.id).toBe("embed-growth");
    expect(dockaroMonthlyCost(1_000_000, "usd").plan?.id).toBe("embed-scale");
  });

  it("returns a quote, never a number, past the top published tier", () => {
    const over = dockaroMonthlyCost(2_000_000, "usd");
    expect(over.plan).toBeNull();
    expect(over.total).toBeNull();
  });

  it("prices the same volume in either currency", () => {
    expect(dockaroMonthlyCost(50_000, "usd").total).toBe(29);
    expect(dockaroMonthlyCost(50_000, "inr").total).toBe(999);
  });
});

describe("competitorMonthlyCost", () => {
  it("uses the cheapest covering plan with no overage", () => {
    const cost = competitorMonthlyCost(ck, 5_000);
    expect(cost.plan.name).toBe("Essential");
    expect(cost.overageBlocks).toBe(0);
    expect(cost.total).toBe(144);
  });

  it("adds auto-charged overage just past the top tier", () => {
    // TinyMCE's top published tier covers 40k; 50k is 10 blocks over at $40.
    const cost = competitorMonthlyCost(tiny, 50_000);
    expect(cost.overageBlocks).toBe(10);
    expect(cost.total).toBe(75 + 10 * 40);
  });

  it("bills a partial block as a whole one, as their terms describe", () => {
    const cost = competitorMonthlyCost(tiny, 40_001);
    expect(cost.overageBlocks).toBe(1);
  });

  it("declines to invent a number far past the top tier", () => {
    // Extrapolating $40/1k to 500k would produce a five-figure fiction.
    expect(competitorMonthlyCost(tiny, 500_000).total).toBeNull();
    expect(competitorMonthlyCost(ck, 500_000).total).toBeNull();
  });

  it("still quotes inside the extrapolation band", () => {
    // 2x the top tier is the documented limit, so it must still be a number.
    const top = tiny.plans[tiny.plans.length - 1];
    expect(competitorMonthlyCost(tiny, top.loads * 2).total).not.toBeNull();
    expect(competitorMonthlyCost(tiny, top.loads * 2 + 1).total).toBeNull();
  });

  it("undercuts both rivals from 25k loads upward", () => {
    for (const loads of [25_000, 50_000, 100_000]) {
      const ours = dockaroMonthlyCost(loads, "usd").total!;
      for (const rival of competitors) {
        const theirs = competitorMonthlyCost(rival, loads).total;
        if (theirs === null || theirs === 0) continue;
        expect(ours).toBeLessThan(theirs);
      }
    }
  });

  it("is NOT the cheapest at every volume, and the calculator must not pretend otherwise", () => {
    // TinyMCE's entry tier covers 10k loads for less than our Starter. That is
    // a real outcome at a real volume, so it is pinned here rather than
    // wished away: EmbedCostCalculator only renders a saving when one exists,
    // and this test fails loudly if a price change ever makes that stale.
    const ours = dockaroMonthlyCost(10_000, "usd").total!;
    const theirs = competitorMonthlyCost(tiny, 10_000).total!;
    expect(theirs).toBeLessThan(ours);
  });
});

describe("formatting", () => {
  it("formats money per currency convention", () => {
    expect(formatMoney(0, "usd")).toBe("$0");
    expect(formatMoney(2999, "inr")).toBe("₹2,999");
    expect(formatMoney(1000, "usd")).toBe("$1,000");
  });

  it("abbreviates load counts the way the slider labels them", () => {
    expect(formatLoads(500)).toBe("500");
    expect(formatLoads(5_000)).toBe("5k");
    expect(formatLoads(250_000)).toBe("250k");
    expect(formatLoads(1_000_000)).toBe("1M");
  });
});
