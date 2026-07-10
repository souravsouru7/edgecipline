const {
  isPremium,
  isTrialActive,
  hasActiveSubscription,
  getTrialState,
  getPlanSource,
  buildTrialStart,
  TRIAL_DAYS,
  TRIAL_MS,
} = require("../../utils/premium");

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
