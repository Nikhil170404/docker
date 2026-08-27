import { describe, expect, it } from "vitest";
import {
  billablePlans,
  BillingError,
  currencyForRegion,
  findBillablePlan,
  isSupportedCurrency,
  isSupportedPeriod,
  methodsForCurrency,
  resolveCheckoutAmount,
  toMinorUnits,
} from "@/lib/billing/pricing";
import { embedPlans, suitePlans, YEARLY_MONTHS_CHARGED } from "@/lib/plans";

describe("billable plans", () => {
  it("excludes every free tier", () => {
    // A checkout for a zero amount is a Razorpay order that can never be paid.
    for (const plan of billablePlans) {
      expect(plan.price.usd).toBeGreaterThan(0);
      expect(plan.price.inr).toBeGreaterThan(0);
    }
    expect(findBillablePlan("free")).toBeNull();
    expect(findBillablePlan("embed-free")).toBeNull();
  });

  it("covers every paid plan the pricing page shows", () => {
    const paid = [...suitePlans, ...embedPlans].filter((p) => p.price.usd > 0);
    expect(billablePlans.map((p) => p.id).sort()).toEqual(paid.map((p) => p.id).sort());
  });

  it("carries the seat minimum from the plan's own note", () => {
    const business = findBillablePlan("business")!;
    expect(business.perSeat).toBe(true);
    expect(business.minimumSeats).toBe(3);
  });

  it("treats flat plans as single-seat", () => {
    const pro = findBillablePlan("pro")!;
    expect(pro.perSeat).toBe(false);
    expect(pro.minimumSeats).toBe(1);
  });
});

describe("minor units", () => {
  it("converts major to minor without floating-point drift", () => {
    expect(toMinorUnits(29)).toBe(2_900);
    expect(toMinorUnits(999)).toBe(99_900);
    // 19.99 * 100 is 1998.9999... in binary floating point.
    expect(toMinorUnits(19.99)).toBe(1_999);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });
});

describe("resolveCheckoutAmount", () => {
  it("charges the monthly price for a monthly period", () => {
    const amount = resolveCheckoutAmount({
      planId: "embed-starter",
      currency: "usd",
      period: "monthly",
    });
    expect(amount.major).toBe(29);
    expect(amount.minor).toBe(2_900);
    expect(amount.description).toContain("1 month");
  });

  it("charges ten months for a year, matching what the page advertises", () => {
    const amount = resolveCheckoutAmount({
      planId: "embed-starter",
      currency: "usd",
      period: "yearly",
    });
    expect(amount.major).toBe(29 * YEARLY_MONTHS_CHARGED);
    expect(amount.description).toContain("1 year");
  });

  it("prices in rupees when asked", () => {
    const amount = resolveCheckoutAmount({
      planId: "embed-growth",
      currency: "inr",
      period: "monthly",
    });
    expect(amount.major).toBe(2_999);
    expect(amount.minor).toBe(299_900); // paise
  });

  it("multiplies per-seat plans by seats", () => {
    const amount = resolveCheckoutAmount({
      planId: "business",
      currency: "usd",
      period: "monthly",
      seats: 5,
    });
    expect(amount.major).toBe(15 * 5);
    expect(amount.description).toContain("× 5 seats");
  });

  it("defaults a per-seat plan to its minimum", () => {
    const amount = resolveCheckoutAmount({
      planId: "business",
      currency: "usd",
      period: "monthly",
    });
    expect(amount.seats).toBe(3);
    expect(amount.major).toBe(45);
  });

  it("refuses fewer seats than the minimum", () => {
    expect(() =>
      resolveCheckoutAmount({ planId: "business", currency: "usd", period: "monthly", seats: 1 }),
    ).toThrow(BillingError);
  });

  it("refuses a seat count on a plan that is not per-seat", () => {
    // Silently charging once would undercharge a customer who thinks they
    // bought ten seats, which is worse than an error.
    expect(() =>
      resolveCheckoutAmount({ planId: "pro", currency: "usd", period: "monthly", seats: 10 }),
    ).toThrow(/not billed per seat/i);
  });

  it("refuses zero, negative and fractional seats", () => {
    for (const seats of [0, -3, 2.5]) {
      expect(() =>
        resolveCheckoutAmount({ planId: "business", currency: "usd", period: "monthly", seats }),
      ).toThrow(BillingError);
    }
  });

  it("refuses an unknown plan rather than charging a default", () => {
    expect(() =>
      resolveCheckoutAmount({ planId: "enterprise-unlimited", currency: "usd", period: "monthly" }),
    ).toThrow(/unknown plan/i);
  });

  it("never produces a zero or negative amount", () => {
    for (const plan of billablePlans) {
      for (const currency of ["inr", "usd"] as const) {
        for (const period of ["monthly", "yearly"] as const) {
          const amount = resolveCheckoutAmount({ planId: plan.id, currency, period });
          expect(amount.minor).toBeGreaterThan(0);
          expect(Number.isInteger(amount.minor)).toBe(true);
        }
      }
    }
  });
});

describe("currency by region", () => {
  it("charges Indian customers in rupees", () => {
    expect(currencyForRegion("IN")).toBe("inr");
    expect(currencyForRegion("in")).toBe("inr");
  });

  it("charges everyone else in dollars", () => {
    for (const country of ["US", "GB", "DE", "SG", "AU", null, undefined, ""]) {
      expect(currencyForRegion(country)).toBe("usd");
    }
  });

  it("offers UPI only where it exists", () => {
    expect(methodsForCurrency("inr")).toContain("UPI");
    expect(methodsForCurrency("usd")).not.toContain("UPI");
  });
});

describe("input guards", () => {
  it("accepts only the two currencies and periods we price in", () => {
    expect(isSupportedCurrency("inr")).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(true);
    for (const bad of ["eur", "INR", "", null, 1, {}]) {
      expect(isSupportedCurrency(bad)).toBe(false);
    }

    expect(isSupportedPeriod("monthly")).toBe(true);
    expect(isSupportedPeriod("yearly")).toBe(true);
    for (const bad of ["weekly", "", null, 7]) {
      expect(isSupportedPeriod(bad)).toBe(false);
    }
  });
});
