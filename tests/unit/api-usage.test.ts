import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetUsage,
  meterRequest,
  recordLoad,
  usageHeaders,
} from "@/lib/api-usage";
import { OVERAGE_POLICY } from "@/lib/plans";

const KEY = "dk_test_51H7x9pQwErTyUiOpAsDfGh";
const FREE_LIMIT = 5_000;
const GRACE_LIMIT = FREE_LIMIT * OVERAGE_POLICY.graceMultiplier;

/** Burn `n` loads and hand back the last state. */
function burn(n: number, key = KEY) {
  let state = recordLoad(key);
  for (let i = 1; i < n; i++) state = recordLoad(key);
  return state;
}

beforeEach(() => __resetUsage());

describe("recordLoad", () => {
  it("counts from one and decrements remaining", () => {
    const first = recordLoad(KEY);
    expect(first.used).toBe(1);
    expect(first.limit).toBe(FREE_LIMIT);
    expect(first.remaining).toBe(FREE_LIMIT - 1);
    expect(first.inGrace).toBe(false);
    expect(first.exhausted).toBe(false);
  });

  it("keeps separate counters per key", () => {
    burn(10, "dk_test_51H7x9pQwErTyUiOpAsDfGh");
    const other = recordLoad("dk_live_someone_else");
    expect(other.used).toBe(1);
  });

  it("serves the last included load without warning", () => {
    const state = burn(FREE_LIMIT);
    expect(state.used).toBe(FREE_LIMIT);
    expect(state.remaining).toBe(0);
    expect(state.inGrace).toBe(false);
    expect(state.exhausted).toBe(false);
  });

  it("enters the grace band one load past the quota", () => {
    const state = burn(FREE_LIMIT + 1);
    expect(state.inGrace).toBe(true);
    expect(state.exhausted).toBe(false);
  });

  it("still serves at the very top of the grace band", () => {
    const state = burn(GRACE_LIMIT);
    expect(state.inGrace).toBe(true);
    expect(state.exhausted).toBe(false);
  });

  it("is exhausted only past the grace band", () => {
    const state = burn(GRACE_LIMIT + 1);
    expect(state.inGrace).toBe(false);
    expect(state.exhausted).toBe(true);
  });

  it("never reports negative remaining", () => {
    const state = burn(FREE_LIMIT + 500);
    expect(state.remaining).toBe(0);
  });
});

describe("usageHeaders", () => {
  it("always states that overage is not billed", () => {
    const headers = usageHeaders(recordLoad(KEY));
    expect(headers["X-DocKaro-Overage-Billing"]).toBe("none");
    expect(headers["X-DocKaro-Loads-Used"]).toBe("1");
    expect(headers["X-DocKaro-Loads-Limit"]).toBe(String(FREE_LIMIT));
    expect(headers["X-DocKaro-Plan"]).toBeTruthy();
  });

  it("adds a warning only inside the grace band", () => {
    expect(usageHeaders(burn(10))["X-DocKaro-Usage-Warning"]).toBeUndefined();
    expect(usageHeaders(burn(FREE_LIMIT + 1))["X-DocKaro-Usage-Warning"]).toMatch(
      /still not billing/i,
    );
  });
});

describe("meterRequest", () => {
  it("lets a request through under quota", () => {
    const { limitResponse } = meterRequest(KEY);
    expect(limitResponse).toBeNull();
  });

  it("lets a request through inside the grace band", () => {
    burn(FREE_LIMIT);
    const { state, limitResponse } = meterRequest(KEY);
    expect(state.inGrace).toBe(true);
    expect(limitResponse).toBeNull();
  });

  it("refuses with 429 past the grace band, charging nothing", async () => {
    burn(GRACE_LIMIT);
    const { limitResponse } = meterRequest(KEY);

    expect(limitResponse).not.toBeNull();
    expect(limitResponse!.status).toBe(429);

    const body = await limitResponse!.json();
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.charged).toBe(0);
    expect(body.error.upgradeUrl).toContain("/pricing");
    expect(limitResponse!.headers.get("X-DocKaro-Overage-Billing")).toBe("none");
  });

  it("never returns a payment-required status — that is the whole promise", () => {
    burn(GRACE_LIMIT + 50);
    const { limitResponse } = meterRequest(KEY);
    expect(limitResponse!.status).not.toBe(402);
  });
});
