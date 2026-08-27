import {
  embedPlans,
  suitePlans,
  YEARLY_MONTHS_CHARGED,
  type Currency,
  type Period,
} from "@/lib/plans";

/**
 * Turning a plan the customer clicked into an amount to charge.
 *
 * Kept free of Razorpay, Supabase and Next so it can be reasoned about (and
 * tested) on its own: everything here is arithmetic and lookups, and it is
 * the only place that decides what a customer owes.
 */

export type BillablePlanId = string;

export interface BillablePlan {
  id: BillablePlanId;
  name: string;
  /** Which product the plan belongs to; both are charged the same way. */
  track: "suite" | "embed";
  price: Record<Currency, number>;
  /** Per-seat plans multiply by seats; the rest ignore it. */
  perSeat: boolean;
  minimumSeats: number;
}

/**
 * Every plan a customer can actually pay for. Free tiers are deliberately
 * absent — there is nothing to charge, and letting a checkout be created for
 * a zero amount is how you end up with ₹0 orders in your Razorpay dashboard.
 */
export const billablePlans: BillablePlan[] = [
  ...suitePlans
    .filter((plan) => plan.price.usd > 0)
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      track: "suite" as const,
      price: plan.price,
      perSeat: plan.unit.includes("/user"),
      minimumSeats: plan.note?.match(/(\d+)\s*user minimum/)
        ? Number(plan.note.match(/(\d+)\s*user minimum/)![1])
        : 1,
    })),
  ...embedPlans
    .filter((plan) => plan.price.usd > 0)
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      track: "embed" as const,
      price: plan.price,
      perSeat: false,
      minimumSeats: 1,
    })),
];

export function findBillablePlan(id: string): BillablePlan | null {
  return billablePlans.find((plan) => plan.id === id) ?? null;
}

/**
 * Razorpay takes amounts in the smallest unit of the currency: paise for
 * INR, cents for USD. Sending rupees where paise are expected undercharges
 * by a factor of a hundred, so nothing else in the codebase is allowed to do
 * this conversion by hand.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

export function toMinorUnits(major: number): number {
  return Math.round(major * MINOR_UNITS_PER_MAJOR);
}

export interface CheckoutAmount {
  plan: BillablePlan;
  currency: Currency;
  period: Period;
  seats: number;
  /** What the customer sees, in rupees or dollars. */
  major: number;
  /** What Razorpay is sent, in paise or cents. */
  minor: number;
  /** Human-readable, for the order note and the receipt. */
  description: string;
}

export class BillingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * What to charge for one checkout.
 *
 * Yearly bills ten months up front rather than twelve — the same discount
 * the pricing page advertises, applied here so the page and the invoice can
 * never disagree.
 */
export function resolveCheckoutAmount(input: {
  planId: string;
  currency: Currency;
  period: Period;
  seats?: number;
}): CheckoutAmount {
  const plan = findBillablePlan(input.planId);
  if (!plan) {
    throw new BillingError(`Unknown plan: ${input.planId}`, "unknown_plan");
  }

  const requestedSeats = input.seats ?? plan.minimumSeats;
  if (!Number.isInteger(requestedSeats) || requestedSeats < 1) {
    throw new BillingError("Seats must be a positive whole number.", "invalid_seats");
  }
  if (plan.perSeat && requestedSeats < plan.minimumSeats) {
    throw new BillingError(
      `${plan.name} starts at ${plan.minimumSeats} seats.`,
      "below_minimum_seats",
    );
  }
  // A seat count on a plan that is not per-seat is a client bug, not a
  // discount opportunity — refuse rather than silently charging once.
  if (!plan.perSeat && requestedSeats !== 1) {
    throw new BillingError(`${plan.name} is not billed per seat.`, "not_per_seat");
  }

  const monthly = plan.price[input.currency] * requestedSeats;
  const major =
    input.period === "yearly" ? monthly * YEARLY_MONTHS_CHARGED : monthly;

  if (major <= 0) {
    throw new BillingError("Nothing to charge for this plan.", "zero_amount");
  }

  const seatSuffix = plan.perSeat ? ` × ${requestedSeats} seats` : "";
  const periodLabel = input.period === "yearly" ? "1 year" : "1 month";

  return {
    plan,
    currency: input.currency,
    period: input.period,
    seats: requestedSeats,
    major,
    minor: toMinorUnits(major),
    description: `DocKaro ${plan.name}${seatSuffix} — ${periodLabel}`,
  };
}

/* ------------------------------------------------------------------ */
/* Which currency to charge in                                         */
/* ------------------------------------------------------------------ */

/**
 * Razorpay settles domestic Indian payments in INR and international cards
 * in the presentment currency, so the choice is a real one rather than
 * cosmetic: an Indian customer charged in USD pays a conversion fee and
 * loses UPI, which is most of the point of Razorpay in India.
 *
 * A customer's own choice always wins — geo is a default, not a verdict, and
 * plenty of people travel or use a VPN.
 */
export function currencyForRegion(
  countryCode: string | null | undefined,
): Currency {
  return countryCode?.toUpperCase() === "IN" ? "inr" : "usd";
}

/** Payment methods Razorpay offers, which differ by market. */
export function methodsForCurrency(currency: Currency): string[] {
  return currency === "inr"
    ? ["UPI", "Netbanking", "Cards", "Wallets"]
    : ["International cards"];
}

export function isSupportedCurrency(value: unknown): value is Currency {
  return value === "inr" || value === "usd";
}

export function isSupportedPeriod(value: unknown): value is Period {
  return value === "monthly" || value === "yearly";
}
