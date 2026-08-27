/**
 * Single source of truth for everything priced on the marketing site and
 * enforced by the API. The pricing page, the embed cost calculator, the
 * comparison page and the usage metering in `api-usage.ts` all read from
 * here, so a price only ever has to change in one place.
 *
 * DocKaro sells on two tracks:
 *   - `suitePlans`  — the hosted office suite, sold per account/seat.
 *   - `embedPlans`  — the embeddable editor + REST API, sold per *editor
 *                     load*, which is the unit CKEditor and TinyMCE bill on.
 *                     Matching their unit is deliberate: it is the only way a
 *                     buyer can compare us to them without doing arithmetic.
 */

export type Currency = "inr" | "usd";
export type Period = "monthly" | "yearly";

/** Yearly billing charges 10 months for 12. Shared by both tracks. */
export const YEARLY_MONTHS_CHARGED = 10;

export type Price = Record<Currency, number>;

export interface SuitePlan {
  id: string;
  name: string;
  tagline: string;
  price: Price;
  unit: string;
  note?: string;
  cta: string;
  href: string;
  highlight?: boolean;
  features: string[];
}

export interface EmbedPlan {
  id: string;
  name: string;
  tagline: string;
  price: Price;
  /** Editor loads included per month. `null` = negotiated/unmetered. */
  loads: number | null;
  note?: string;
  cta: string;
  href: string;
  highlight?: boolean;
  /** Self-hosting the editor bundle is allowed on this tier. */
  selfHost: boolean;
  features: string[];
}

export const suitePlans: SuitePlan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Try it with no commitment",
    price: { inr: 0, usd: 0 },
    unit: "",
    cta: "Start free",
    href: "/editor/docs",
    features: [
      "Docs + Sheets editors",
      "Up to 3 active documents",
      "Open and export .docx — real Word files",
      "DocKaro watermark on PDF export",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For individuals and freelancers",
    price: { inr: 499, usd: 19 },
    unit: "/mo",
    cta: "Start Pro trial",
    href: "/editor/docs",
    highlight: true,
    features: [
      "Everything in Free",
      "Unlimited documents & spreadsheets",
      "No watermark on exports",
      "10 GB cloud storage",
      "Version history (30 days)",
      "Priority email support",
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "For teams and agencies",
    price: { inr: 399, usd: 15 },
    unit: "/user/mo",
    note: "3 user minimum",
    cta: "Start Business trial",
    href: "/editor/docs",
    features: [
      "Everything in Pro",
      "Shared team workspace",
      "Admin roles & permissions",
      "Unlimited version history",
      "Priority chat support",
    ],
  },
];

/**
 * Embed pricing. The tier shape mirrors CKEditor's and TinyMCE's (free tier →
 * two paid tiers → a top tier) so the plans line up column-for-column on a
 * comparison table, but three things are deliberately different:
 *
 *   1. The free tier carries 5,000 loads, not 1,000. A prototype should never
 *      hit a paywall before it ships.
 *   2. Nothing auto-bills on overage. Both competitors charge per extra block
 *      of 1,000 loads (CKEditor $30–$60, TinyMCE $40); we soft-cap instead —
 *      see `OVERAGE_POLICY` and `api-usage.ts`.
 *   3. Self-hosting is a checkbox on a published tier, not a "contact sales"
 *      conversation.
 */
export const embedPlans: EmbedPlan[] = [
  {
    id: "embed-free",
    name: "Free",
    tagline: "Prototype and ship small",
    price: { inr: 0, usd: 0 },
    loads: 5_000,
    cta: "Get API key",
    href: "/api-docs",
    selfHost: true,
    features: [
      "5,000 editor loads / month",
      "Rich-text AND document mode",
      "Paste-from-Word cleanup included",
      "HTML and .docx out of the same embed",
      "No licence key, no banner, ever",
      "Community support",
    ],
  },
  {
    id: "embed-starter",
    name: "Starter",
    tagline: "For a product in production",
    price: { inr: 999, usd: 29 },
    loads: 50_000,
    cta: "Start Starter",
    href: "/api-docs",
    selfHost: true,
    features: [
      "50,000 editor loads / month",
      "REST API — create, edit, export",
      "Webhooks for document events",
      "Soft cap — we email, we never auto-bill",
      "Email support, 1 business day",
    ],
  },
  {
    id: "embed-growth",
    name: "Growth",
    tagline: "For scale-ups embedding at volume",
    price: { inr: 2_999, usd: 99 },
    loads: 250_000,
    cta: "Start Growth",
    href: "/api-docs",
    highlight: true,
    selfHost: true,
    features: [
      "250,000 editor loads / month",
      "Everything in Starter",
      "Comments & track changes in the embed",
      "99.9% uptime SLA",
      "Priority support, 4 business hours",
    ],
  },
  {
    id: "embed-scale",
    name: "Scale",
    tagline: "Self-host it or run it air-gapped",
    price: { inr: 8_999, usd: 299 },
    loads: 1_000_000,
    note: "Published price — no sales call to buy",
    cta: "Start Scale",
    href: "/api-docs",
    selfHost: true,
    features: [
      "1,000,000 editor loads / month",
      "Perpetual self-host licence included",
      "Air-gapped / on-prem deployment",
      "SSO, audit log, custom data residency",
      "Named engineer, 1 business hour",
    ],
  },
];

/**
 * What happens when a customer goes past their included loads. This is the
 * single biggest complaint developers raise about both competitors, so it is
 * stated as data rather than prose and rendered verbatim on the pricing page.
 */
export const OVERAGE_POLICY = {
  autoBilled: false,
  hardBlock: false,
  graceMultiplier: 1.2,
  summary:
    "Go over and nothing is charged automatically. We email you at 80% and " +
    "again at 100%, keep serving editors through a 20% grace band, and only " +
    "then ask you to move up a tier. Your card is never hit by surprise.",
} as const;

/* ------------------------------------------------------------------ */
/* Competitor reference data                                           */
/* ------------------------------------------------------------------ */

export interface CompetitorPlan {
  name: string;
  /** USD per month on monthly billing. */
  usd: number;
  loads: number;
  /** USD auto-charged per additional block of 1,000 loads. */
  overagePer1k: number;
}

export interface Competitor {
  id: string;
  name: string;
  /** Cheapest paid entry point, for prose. */
  plans: CompetitorPlan[];
  licence: string;
  selfHostNote: string;
}

/**
 * Published list prices, gathered Aug 2026 from third-party pricing trackers
 * and the vendors' own terms (the vendor pricing pages themselves are not
 * reachable from this build environment). Treat as indicative: re-verify
 * against ckeditor.com/pricing and tiny.cloud/pricing before this goes live,
 * and keep `COMPETITOR_DATA_AS_OF` honest when you do.
 */
export const COMPETITOR_DATA_AS_OF = "August 2026";

export const competitors: Competitor[] = [
  {
    id: "ckeditor",
    name: "CKEditor 5",
    plans: [
      { name: "Free", usd: 0, loads: 1_000, overagePer1k: 60 },
      { name: "Essential", usd: 144, loads: 5_000, overagePer1k: 45 },
      { name: "Professional", usd: 405, loads: 20_000, overagePer1k: 30 },
      { name: "Enterprise", usd: 864, loads: 100_000, overagePer1k: 30 },
    ],
    licence: "GPL 2+ or paid commercial licence",
    selfHostNote: "Commercial self-hosting is a sales conversation.",
  },
  {
    id: "tinymce",
    name: "TinyMCE",
    plans: [
      { name: "Free", usd: 0, loads: 1_000, overagePer1k: 40 },
      { name: "Essential", usd: 25, loads: 10_000, overagePer1k: 40 },
      { name: "Professional", usd: 75, loads: 40_000, overagePer1k: 40 },
    ],
    licence: "GPL 2+ (since v7) or paid commercial licence",
    selfHostNote:
      "Self-hosted builds require a licence key; commercial terms via sales.",
  },
];

/* ------------------------------------------------------------------ */
/* Cost helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * How far past a vendor's top published tier we are willing to extrapolate
 * their overage rate before calling the result "negotiated" instead.
 *
 * Applying a $30–$60 per-1,000 overage rate to an arbitrarily large volume
 * produces five-figure monthly numbers that no real customer pays — at that
 * point they are on a bespoke enterprise contract. Quoting the extrapolation
 * anyway would make our own comparison page the least trustworthy thing on
 * it. Inside this band the overage arithmetic is a fair reading of their
 * published terms; past it we decline to put a number in their mouth.
 */
const OVERAGE_EXTRAPOLATION_LIMIT = 2;

export interface CompetitorCost {
  plan: CompetitorPlan;
  overageBlocks: number;
  /** `null` when the volume is past what their published terms sensibly cover. */
  total: number | null;
}

/**
 * Monthly USD cost of `loads` on a competitor: the cheapest plan that covers
 * the volume, or the top plan plus auto-charged overage blocks just above it.
 * Overage bills per *started* block of 1,000, which is how both vendors' terms
 * describe it. Returns `total: null` once the volume is far enough past their
 * top tier that the honest answer is "negotiated".
 */
export function competitorMonthlyCost(
  competitor: Competitor,
  loads: number,
): CompetitorCost {
  const covering = competitor.plans.find((p) => loads <= p.loads);
  if (covering) {
    return { plan: covering, overageBlocks: 0, total: covering.usd };
  }

  const top = competitor.plans[competitor.plans.length - 1];
  if (loads > top.loads * OVERAGE_EXTRAPOLATION_LIMIT) {
    return { plan: top, overageBlocks: 0, total: null };
  }

  const overageBlocks = Math.ceil((loads - top.loads) / 1_000);
  return {
    plan: top,
    overageBlocks,
    total: top.usd + overageBlocks * top.overagePer1k,
  };
}

/**
 * Monthly cost of `loads` on DocKaro, in the requested currency. There is no
 * overage arm here by design — past the top published tier the answer is a
 * quote, not a surprise line item.
 */
export function dockaroMonthlyCost(
  loads: number,
  currency: Currency,
): { plan: EmbedPlan | null; total: number | null } {
  const covering = embedPlans.find((p) => p.loads !== null && loads <= p.loads);
  if (!covering) return { plan: null, total: null };
  return { plan: covering, total: covering.price[currency] };
}

export const formatMoney = (n: number, currency: Currency) =>
  currency === "inr"
    ? `₹${n.toLocaleString("en-IN")}`
    : `$${n.toLocaleString("en-US")}`;

export const formatLoads = (n: number) =>
  n >= 1_000_000
    ? `${n / 1_000_000}M`
    : n >= 1_000
      ? `${n / 1_000}k`
      : String(n);
