// The 7-day trial is RETIRED in the shipped config — the free tier is now the
// 2-trades-per-market allowance. The machinery is kept behind a switch, so
// this suite loads it with trials ON to keep covering that machinery, and the
// final block asserts what actually ships.
//
// The env var is restored immediately after each load. Jest reuses worker
// processes across test files, so leaving it set at file scope leaks into
// unrelated suites and makes them fail only when run together.
function loadPremium(enabled) {
  const previous = process.env.TRIAL_ENABLED;
  let mod;
  jest.isolateModules(() => {
    process.env.TRIAL_ENABLED = enabled ? "true" : "false";
    mod = require("../../utils/premium");
  });
  if (previous === undefined) delete process.env.TRIAL_ENABLED;
  else process.env.TRIAL_ENABLED = previous;
  return mod;
}

const {
  isPremium,
  isTrialActive,
  hasActiveSubscription,
  getTrialState,
  getPlanSource,
  buildTrialStart,
  TRIAL_DAYS,
  TRIAL_MS,
} = loadPremium(true);

const future = (ms) => new Date(Date.now() + ms);
const past   = (ms) => new Date(Date.now() - ms);
const ONE_DAY = 24 * 60 * 60 * 1000;

describe("trial-aware isPremium", () => {
  it("returns true while inside the trial window even without a paid plan", () => {
    expect(isPremium({
      subscriptionStatus: "inactive",
      subscriptionPlan:   "free",
      trial: { startedAt: past(ONE_DAY), endsAt: future(6 * ONE_DAY), used: true },
    })).toBe(true);
  });

  it("returns false once trial.endsAt is in the past and no paid plan exists", () => {
    expect(isPremium({
      subscriptionStatus: "inactive",
      subscriptionPlan:   "free",
      trial: { startedAt: past(8 * ONE_DAY), endsAt: past(ONE_DAY), used: true },
    })).toBe(false);
  });

  it("still returns true for a paid sub even when trial has expired", () => {
    expect(isPremium({
      subscriptionStatus: "active",
      subscriptionPlan:   "monthly",
      subscriptionExpiry: future(30 * ONE_DAY),
      trial: { startedAt: past(8 * ONE_DAY), endsAt: past(ONE_DAY), used: true },
    })).toBe(true);
  });

  it("returns false for a user with no trial and no subscription", () => {
    expect(isPremium({ subscriptionStatus: "inactive", subscriptionPlan: "free" })).toBe(false);
  });
});

describe("isTrialActive", () => {
  it("returns false when trial.endsAt is missing", () => {
    expect(isTrialActive({ trial: {} })).toBe(false);
    expect(isTrialActive({})).toBe(false);
    expect(isTrialActive(null)).toBe(false);
  });

  it("returns true exactly while endsAt is in the future", () => {
    expect(isTrialActive({ trial: { endsAt: future(1000) } })).toBe(true);
    expect(isTrialActive({ trial: { endsAt: past(1000) } })).toBe(false);
  });
});

describe("hasActiveSubscription", () => {
  it("rejects free plans even when status is active", () => {
    expect(hasActiveSubscription({
      subscriptionStatus: "active",
      subscriptionPlan:   "free",
    })).toBe(false);
  });

  it("rejects expired paid plans", () => {
    expect(hasActiveSubscription({
      subscriptionStatus: "active",
      subscriptionPlan:   "monthly",
      subscriptionExpiry: past(ONE_DAY),
    })).toBe(false);
  });
});

describe("getTrialState", () => {
  it("returns null for legacy users with no trial fields", () => {
    expect(getTrialState({ subscriptionStatus: "inactive", subscriptionPlan: "free" })).toBeNull();
  });

  it("reports daysRemaining ceiling-rounded inside the window", () => {
    const state = getTrialState({
      trial: { startedAt: past(2 * ONE_DAY), endsAt: future(5 * ONE_DAY - 500), used: true },
    });
    expect(state.active).toBe(true);
    expect(state.daysRemaining).toBe(5);
    expect(state.expired).toBe(false);
  });

  it("flags expired after the window closes", () => {
    const state = getTrialState({
      trial: { startedAt: past(8 * ONE_DAY), endsAt: past(ONE_DAY), used: true },
    });
    expect(state.active).toBe(false);
    expect(state.expired).toBe(true);
    expect(state.daysRemaining).toBe(0);
  });
});

describe("getPlanSource", () => {
  it("admin > subscription > trial > free", () => {
    expect(getPlanSource({ role: "admin" })).toBe("admin");
    expect(getPlanSource({
      subscriptionStatus: "active",
      subscriptionPlan:   "monthly",
      subscriptionExpiry: future(ONE_DAY),
      trial: { endsAt: future(ONE_DAY), used: true },
    })).toBe("subscription");
    expect(getPlanSource({
      trial: { endsAt: future(ONE_DAY), used: true },
    })).toBe("trial");
    expect(getPlanSource({})).toBe("free");
  });
});

describe("authCache projection includes trial (regression)", () => {
  // If trial is dropped from the projection, isPremium() goes false on every
  // cache hit and trial users silently lose premium after request #1.
  it("CACHE_PROJECTION contains 'trial'", () => {
    const { CACHE_PROJECTION } = require("../../services/authCacheService");
    expect(CACHE_PROJECTION).toContain("trial");
  });
});

describe("buildTrialStart", () => {
  it("sets used=true and a 7-day window from `now`", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const payload = buildTrialStart({ source: "auto_register", now });
    expect(payload.trial.used).toBe(true);
    expect(payload.trial.source).toBe("auto_register");
    expect(payload.trial.startedAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(payload.trial.endsAt.getTime() - payload.trial.startedAt.getTime()).toBe(TRIAL_MS);
  });

  it("TRIAL_DAYS exported is 7", () => {
    expect(TRIAL_DAYS).toBe(7);
  });
});


describe("shipped default: the trial is retired", () => {
  const loadWithTrial = loadPremium;

  const midTrial = {
    subscriptionStatus: "inactive",
    subscriptionPlan: "free",
    trial: { startedAt: past(ONE_DAY), endsAt: future(3 * ONE_DAY), used: true },
  };

  it("does not grant premium to a user carrying a stale trial", () => {
    expect(loadWithTrial(false).isPremium(midTrial)).toBe(false);
  });

  it("reports no trial state, so the badge and countdown banner stay empty", () => {
    expect(loadWithTrial(false).getTrialState(midTrial)).toBeNull();
  });

  it("resolves planSource to free rather than trial", () => {
    expect(loadWithTrial(false).getPlanSource(midTrial)).toBe("free");
  });

  it("creates new accounts with no trial subdocument", () => {
    expect(loadWithTrial(false).buildTrialStart()).toEqual({});
  });

  it("still honours a paid subscription", () => {
    expect(loadWithTrial(false).isPremium({
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: future(30 * ONE_DAY),
    })).toBe(true);
  });

  it("still honours admins", () => {
    expect(loadWithTrial(false).isPremium({ role: "admin" })).toBe(true);
  });

  it("re-enabling the switch restores the old behaviour", () => {
    expect(loadWithTrial(true).isPremium(midTrial)).toBe(true);
  });
});
