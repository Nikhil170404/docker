import { NextResponse } from "next/server";
import { embedPlans, OVERAGE_POLICY, type EmbedPlan } from "@/lib/plans";

/**
 * Editor-load metering with a soft cap.
 *
 * Both CKEditor and TinyMCE meter the same unit we do — an "editor load" — but
 * they auto-charge for every additional block of 1,000 once you pass your
 * quota. That is the complaint developers raise most often, and it is worst
 * for self-hosted and open-source deployments where you cannot control how
 * many people install the thing that loads the editor.
 *
 * So the cap here never bills and never hard-blocks. It counts, it warns on
 * every response via headers, it keeps serving through a grace band, and past
 * that it returns a 429 that asks for an upgrade instead of quietly running up
 * an invoice. A 429 you can see in your logs is recoverable; a surprise
 * invoice is not.
 *
 * The counter is in-process and resets on restart, matching the demo key store
 * in `api-auth.ts`. Swap both for a real table (usage: {keyHash, periodStart,
 * loads}) when billing is wired up.
 */

interface UsageRecord {
  loads: number;
  /** UTC month this record counts, as `YYYY-MM`. */
  period: string;
}

const usage = new Map<string, UsageRecord>();

const currentPeriod = () => new Date().toISOString().slice(0, 7);

/**
 * The plan a key is on.
 *
 * Taken from the key record rather than guessed from its prefix: what a
 * customer has paid for is a fact in the database, and inferring it from the
 * shape of a string was only ever a placeholder.
 */
function planForId(planId: string): EmbedPlan {
  const free = embedPlans.find((p) => p.id === "embed-free");
  if (!free) throw new Error("embed-free plan missing from plans.ts");
  return embedPlans.find((p) => p.id === planId) ?? free;
}

export interface UsageState {
  plan: EmbedPlan;
  used: number;
  limit: number;
  remaining: number;
  /** Past the included quota but inside the grace band. */
  inGrace: boolean;
  /** Past the grace band — the only state that refuses work. */
  exhausted: boolean;
}

/**
 * Count one editor load against `key` and report where that leaves it.
 * Rolls the counter over when the UTC month changes.
 */
export function recordLoad(key: string, planId = "embed-free"): UsageState {
  const plan = planForId(planId);
  const period = currentPeriod();
  const record = usage.get(key);

  const next: UsageRecord =
    record && record.period === period
      ? { loads: record.loads + 1, period }
      : { loads: 1, period };
  usage.set(key, next);

  // `loads: null` means a negotiated, unmetered contract.
  const limit = plan.loads ?? Number.POSITIVE_INFINITY;
  const graceLimit = limit * OVERAGE_POLICY.graceMultiplier;

  return {
    plan,
    used: next.loads,
    limit,
    remaining: Math.max(0, limit - next.loads),
    inGrace: next.loads > limit && next.loads <= graceLimit,
    exhausted: next.loads > graceLimit,
  };
}

/**
 * Usage headers on every response, so a customer can alert on their own
 * consumption long before we email them — and never has to discover the
 * number on an invoice.
 */
export function usageHeaders(state: UsageState): Record<string, string> {
  const headers: Record<string, string> = {
    "X-DocKaro-Plan": state.plan.name,
    "X-DocKaro-Loads-Used": String(state.used),
    "X-DocKaro-Loads-Limit": Number.isFinite(state.limit)
      ? String(state.limit)
      : "unmetered",
    "X-DocKaro-Loads-Remaining": Number.isFinite(state.limit)
      ? String(state.remaining)
      : "unmetered",
    // Stated on every response so it is never a surprise at renewal.
    "X-DocKaro-Overage-Billing": "none",
  };

  if (state.inGrace) {
    headers["X-DocKaro-Usage-Warning"] =
      "Over the included quota and inside the grace band. Still serving, " +
      "still not billing. Move up a tier when convenient.";
  }

  return headers;
}

/**
 * Meter the request. Returns a 429 only when the grace band is spent — every
 * other outcome returns null and leaves the caller to do its work, with
 * `state` carrying the headers to attach.
 */
export function meterRequest(
  key: string,
  planId = "embed-free",
): {
  state: UsageState;
  limitResponse: NextResponse | null;
} {
  const state = recordLoad(key, planId);

  if (!state.exhausted) return { state, limitResponse: null };

  return {
    state,
    limitResponse: NextResponse.json(
      {
        error: {
          code: "quota_exceeded",
          message:
            `You have used ${state.used} editor loads this month on the ` +
            `${state.plan.name} plan, past the ${state.limit} included and ` +
            `the grace band above it. Nothing has been charged — upgrade at ` +
            `/pricing and this clears immediately.`,
          upgradeUrl: "https://dockaro.com/pricing",
          charged: 0,
        },
      },
      { status: 429, headers: usageHeaders(state) },
    ),
  };
}

/** Test seam — resets the in-process counters. */
export function __resetUsage() {
  usage.clear();
}
