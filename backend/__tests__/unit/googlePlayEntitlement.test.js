// Phase 11 — the subscription state machine, and Phase 13 — proof that adding
// Google Play did not change what a Razorpay user gets.
//
// These two live together on purpose: the entire safety argument for this
// integration is that Play writes a SEPARATE field and isPremium takes the
// union, so the Razorpay assertions here are as load-bearing as the Play ones.

const {
  isPremium,
  hasActiveSubscription,
  hasActivePlaySubscription,
  getEffectiveExpiry,
  getBillingProvider,
  getPlanSource,
} = require("../../utils/premium");

const {
  SUBSCRIPTION_STATES,
  grantsEntitlement,
  mapPlayState,
  isAllowedProductId,
  getBasePlan,
  isWellFormedPurchaseToken,
  BASE_PLAN_IDS,
} = require("../../constants/googlePlay");

const ONE_DAY = 24 * 60 * 60 * 1000;
const future = (ms = ONE_DAY) => new Date(Date.now() + ms);
const past = (ms = ONE_DAY) => new Date(Date.now() - ms);

describe("Play state -> entitlement (Phase 11)", () => {
  it("grants while ACTIVE and not yet expired", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.ACTIVE, future())).toBe(true);
  });

  it("keeps access after cancellation until the paid-through date", () => {
    // The user turned off auto-renew but has already paid for the rest of the
    // period. Revoking now would be taking back time they bought.
    expect(grantsEntitlement(SUBSCRIPTION_STATES.CANCELLED, future())).toBe(true);
  });

  it("drops access once a cancelled subscription passes its expiry", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.CANCELLED, past())).toBe(false);
  });

  it("keeps access during the grace period", () => {
    // Google is still retrying the payment. Locking a paying customer out
    // because their card expired is the failure this prevents.
    expect(grantsEntitlement(SUBSCRIPTION_STATES.GRACE_PERIOD, future())).toBe(true);
  });

  it("revokes access on ON_HOLD even when Play still reports a future expiry", () => {
    // This is why the check is state-based and not expiry-only.
    expect(grantsEntitlement(SUBSCRIPTION_STATES.ON_HOLD, future())).toBe(false);
  });

  it("revokes access while PAUSED", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.PAUSED, future())).toBe(false);
  });

  it("never grants on PENDING — Google has not taken the money", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.PENDING, future())).toBe(false);
  });

  it("revokes on EXPIRED and REVOKED", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.EXPIRED, future())).toBe(false);
    expect(grantsEntitlement(SUBSCRIPTION_STATES.REVOKED, future())).toBe(false);
  });

  it("refuses to grant on a stale ACTIVE snapshot whose expiry has passed", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.ACTIVE, past())).toBe(false);
  });

  it("never grants without an expiry at all", () => {
    expect(grantsEntitlement(SUBSCRIPTION_STATES.ACTIVE, null)).toBe(false);
  });

  it("maps every Play state, defaulting the unknown ones to pending", () => {
    expect(mapPlayState("SUBSCRIPTION_STATE_ACTIVE")).toBe(SUBSCRIPTION_STATES.ACTIVE);
    expect(mapPlayState("SUBSCRIPTION_STATE_IN_GRACE_PERIOD")).toBe(SUBSCRIPTION_STATES.GRACE_PERIOD);
    expect(mapPlayState("SUBSCRIPTION_STATE_ON_HOLD")).toBe(SUBSCRIPTION_STATES.ON_HOLD);
    expect(mapPlayState("SUBSCRIPTION_STATE_CANCELED")).toBe(SUBSCRIPTION_STATES.CANCELLED);
    // An unmapped/unknown state must fail CLOSED, never to active.
    expect(mapPlayState("SUBSCRIPTION_STATE_UNSPECIFIED")).toBe(SUBSCRIPTION_STATES.PENDING);
    expect(mapPlayState("SOMETHING_GOOGLE_ADDS_LATER")).toBe(SUBSCRIPTION_STATES.PENDING);
    expect(mapPlayState(undefined)).toBe(SUBSCRIPTION_STATES.PENDING);
  });
});

describe("product allowlist (Phase 4)", () => {
  it("accepts only the Edgecipline subscription product", () => {
    expect(isAllowedProductId("edgecipline_pro")).toBe(true);
    expect(isAllowedProductId("edgecipline_pro_hacked")).toBe(false);
    expect(isAllowedProductId("some.other.developer.product")).toBe(false);
    expect(isAllowedProductId("")).toBe(false);
    expect(isAllowedProductId(null)).toBe(false);
  });

  it("resolves the three base plans that mirror the web catalogue", () => {
    expect(BASE_PLAN_IDS).toEqual([
      "edgecipline-pro-monthly",
      "edgecipline-pro-3month",
      "edgecipline-pro-6month",
    ]);
    expect(getBasePlan("edgecipline-pro-monthly").planType).toBe("monthly");
    expect(getBasePlan("edgecipline-pro-3month").planType).toBe("3_months");
    expect(getBasePlan("edgecipline-pro-6month").planType).toBe("6_months");
    expect(getBasePlan("edgecipline-pro-lifetime-free")).toBeNull();
  });

  it("carries no price — Play Console owns pricing", () => {
    for (const id of BASE_PLAN_IDS) {
      const plan = getBasePlan(id);
      expect(plan).not.toHaveProperty("amount");
      expect(plan).not.toHaveProperty("price");
      expect(plan).not.toHaveProperty("listAmount");
    }
  });

  it("rejects malformed purchase tokens before spending a Play API call", () => {
    expect(isWellFormedPurchaseToken("a".repeat(60))).toBe(true);
    expect(isWellFormedPurchaseToken("short")).toBe(false);
    expect(isWellFormedPurchaseToken("has spaces in it aaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isWellFormedPurchaseToken("../../etc/passwd-aaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(isWellFormedPurchaseToken("a".repeat(5000))).toBe(false);
    expect(isWellFormedPurchaseToken(null)).toBe(false);
  });
});

describe("isPremium is the union of both providers (Phase 1)", () => {
  it("grants on an active Play subscription with no Razorpay history at all", () => {
    expect(
      isPremium({
        subscriptionStatus: "inactive",
        subscriptionPlan: "free",
        playEntitlementExpiry: future(),
      })
    ).toBe(true);
  });

  it("drops to free once the Play entitlement expires", () => {
    expect(
      isPremium({
        subscriptionStatus: "inactive",
        subscriptionPlan: "free",
        playEntitlementExpiry: past(),
      })
    ).toBe(false);
  });

  it("reports the source as a subscription so existing consumers keep working", () => {
    // getPlanSource feeds the settings badge, the rescue funnel and analytics.
    // A new value here would silently break all three.
    expect(getPlanSource({ playEntitlementExpiry: future() })).toBe("subscription");
  });

  it("names the processor separately, so the UI can send the user to Play", () => {
    expect(getBillingProvider({ playEntitlementExpiry: future() })).toBe("google_play");
    expect(
      getBillingProvider({
        subscriptionStatus: "active",
        subscriptionPlan: "monthly",
        subscriptionExpiry: future(),
      })
    ).toBe("razorpay");
    expect(getBillingProvider({})).toBeNull();
  });

  it("picks the longer-running provider when a user holds both", () => {
    const user = {
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: future(10 * ONE_DAY),
      playEntitlementExpiry: future(90 * ONE_DAY),
    };
    expect(getBillingProvider(user)).toBe("google_play");
    expect(getEffectiveExpiry(user).getTime()).toBe(new Date(user.playEntitlementExpiry).getTime());
  });
});

describe("Razorpay behaviour is unchanged (Phase 13)", () => {
  const razorpayUser = {
    subscriptionStatus: "active",
    subscriptionPlan: "monthly",
    subscriptionExpiry: future(30 * ONE_DAY),
  };

  it("still grants premium to a paid web subscriber", () => {
    expect(isPremium(razorpayUser)).toBe(true);
    expect(hasActiveSubscription(razorpayUser)).toBe(true);
  });

  it("still expires a web subscriber whose date has passed", () => {
    expect(
      isPremium({ subscriptionStatus: "active", subscriptionPlan: "monthly", subscriptionExpiry: past() })
    ).toBe(false);
  });

  it("treats a legacy user with no playEntitlementExpiry field exactly as before", () => {
    // This is why the change needs no migration: `undefined` is never in the
    // future, so every pre-existing account resolves down the old path.
    expect(hasActivePlaySubscription(razorpayUser)).toBe(false);
    expect(hasActivePlaySubscription({})).toBe(false);
    expect(getBillingProvider(razorpayUser)).toBe("razorpay");
  });

  it("does not let an expired Play subscription revoke live Razorpay days", () => {
    // The scenario the two-field design exists to prevent: a user with a month
    // of web time left cancels on Android and must keep the web time.
    const both = {
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: future(30 * ONE_DAY),
      playEntitlementExpiry: null,
    };
    expect(isPremium(both)).toBe(true);
    expect(getBillingProvider(both)).toBe("razorpay");
    expect(getEffectiveExpiry(both).getTime()).toBe(new Date(both.subscriptionExpiry).getTime());
  });

  it("admins stay premium regardless of provider", () => {
    expect(isPremium({ role: "admin" })).toBe(true);
  });
});

describe("effective expiry", () => {
  it("is null for a free user", () => {
    expect(getEffectiveExpiry({ subscriptionStatus: "inactive" })).toBeNull();
  });

  it("reports the Play date for a Play-only subscriber", () => {
    // Reading subscriptionExpiry directly would show them "Active until —".
    const expiry = future(14 * ONE_DAY);
    expect(getEffectiveExpiry({ playEntitlementExpiry: expiry }).getTime()).toBe(expiry.getTime());
  });

  it("ignores an expired provider when picking the furthest date", () => {
    const live = future(5 * ONE_DAY);
    const user = {
      subscriptionStatus: "expired",
      subscriptionPlan: "monthly",
      subscriptionExpiry: past(100 * ONE_DAY),
      playEntitlementExpiry: live,
    };
    expect(getEffectiveExpiry(user).getTime()).toBe(live.getTime());
  });
});
