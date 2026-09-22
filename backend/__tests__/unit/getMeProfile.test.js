"use strict";

// /auth/me feeds the settings page. It previously returned only name, email,
// role and createdAt, so a paying customer was rendered "Free / Inactive" and
// every date showed "-". These lock that shape in.

jest.mock("../../models/Users", () => ({ findById: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/googlePlayBillingService", () => ({
  getPlaySubscriptionSummary: jest.fn().mockResolvedValue(null),
}));

const User = require("../../models/Users");
const { getPlaySubscriptionSummary } = require("../../services/googlePlayBillingService");
const { logger } = require("../../utils/logger");
const { getMe } = require("../../controllers/authController");

const USER_ID = "507f1f77bcf86cd799439011";
const CREATED = new Date("2026-08-22T05:24:07.095Z");
const LAST_LOGIN = new Date("2026-08-26T05:33:17.283Z");

function mockDetails(value) {
  User.findById.mockReturnValue({
    select: () => ({ lean: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)) }),
  });
}

function baseUser(over = {}) {
  return {
    _id: USER_ID, name: "Sourav R", email: "s@example.com", role: "user",
    authProvider: "local", subscriptionStatus: "inactive", subscriptionPlan: "free",
    termsAcceptance: { acceptedAt: new Date(), version: "1.0" },
    ...over,
  };
}

async function call(user) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await getMe({ user }, res, next);
  if (next.mock.calls.length) throw next.mock.calls[0][0];
  return res.json.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDetails({ createdAt: CREATED, lastLogin: LAST_LOGIN });
});

describe("subscription state reaches the client", () => {
  test("a paying customer is reported active, not free", async () => {
    const body = await call(baseUser({
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: new Date("2026-09-25T11:12:18.305Z"),
    }));

    expect(body.subscriptionStatus).toBe("active");
    expect(body.subscriptionPlan).toBe("monthly");
    expect(body.subscriptionExpiry).toEqual(new Date("2026-09-25T11:12:18.305Z"));
    expect(body.isPremium).toBe(true);
  });

  test("a free user is reported free and not premium", async () => {
    const body = await call(baseUser());
    expect(body.subscriptionPlan).toBe("free");
    expect(body.isPremium).toBe(false);
  });

  test("an expired subscription is not premium", async () => {
    const body = await call(baseUser({
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: new Date(Date.now() - 864e5),
    }));
    expect(body.isPremium).toBe(false);
  });
});

describe("retired trial grants no access", () => {
  test("a stale trial grants nothing — the trial is retired", async () => {
    const body = await call(baseUser({
      trial: { startedAt: new Date(Date.now() - 864e5), endsAt: new Date(Date.now() + 3 * 864e5) },
    }));

    // An account created before the trial was retired still carries the
    // subdocument; it must not keep handing out free access.
    expect(body.isPremium).toBe(false);
    expect(body.trial).toBeNull();
  });

  test("an expired trial is not premium", async () => {
    const body = await call(baseUser({
      trial: { startedAt: new Date(Date.now() - 10 * 864e5), endsAt: new Date(Date.now() - 864e5), used: true },
    }));
    expect(body.isPremium).toBe(false);
    expect(body.trial).toBeNull();
  });

  test("a user who never had a trial reports null", async () => {
    const body = await call(baseUser());
    expect(body.trial).toBeNull();
  });
});

describe("account dates", () => {
  test("createdAt and lastLogin are returned", async () => {
    const body = await call(baseUser());
    expect(body.createdAt).toEqual(CREATED);
    expect(body.lastLogin).toEqual(LAST_LOGIN);
  });

  test("admins are premium", async () => {
    const body = await call(baseUser({ role: "admin" }));
    expect(body.isPremium).toBe(true);
  });
});

describe("the extra lookup can never break the profile", () => {
  test("a database failure degrades to nulls instead of throwing", async () => {
    mockDetails(new Error("connection lost"));
    const body = await call(baseUser({ subscriptionStatus: "active", subscriptionPlan: "monthly" }));

    // The page still renders; only the dates are missing.
    expect(body.createdAt).toBeNull();
    expect(body.lastLogin).toBeNull();
    expect(body.subscriptionPlan).toBe("monthly");
    expect(logger.warn).toHaveBeenCalledWith("GET_ME_DETAIL_LOOKUP_FAILED", expect.any(Object));
  });

  test("a missing user document degrades to nulls", async () => {
    mockDetails(null);
    const body = await call(baseUser());
    expect(body.createdAt).toBeNull();
    expect(body.lastLogin).toBeNull();
  });
});

describe("Google Play detail on the resolved subscription object", () => {
  const ONE_DAY = 24 * 60 * 60 * 1000;

  test("getMe.subscription carries cancelAtPeriodEnd/state/planType for a Play subscriber", async () => {
    const expiry = new Date(Date.now() + 20 * ONE_DAY);
    getPlaySubscriptionSummary.mockResolvedValueOnce({
      state: "cancelled",
      active: true,
      basePlanId: "edgecipline-pro-6month",
      planType: "6_months",
      expiresAt: expiry,
      autoRenewing: false,
      cancelAtPeriodEnd: true,
      purchaseRef: "abcdef0123456789",
    });

    const body = await call(baseUser({ subscriptionPlan: "monthly", playEntitlementExpiry: expiry }));

    expect(body.subscription).toMatchObject({
      status: "active",
      provider: "google_play",
      planLabel: "6-month Pro",
      cancelAtPeriodEnd: true,
      state: "cancelled",
      basePlanId: "edgecipline-pro-6month",
      planType: "6_months",
      purchaseRef: "abcdef0123456789",
    });
    expect(body.subscription.expiresAt).toEqual(expiry);
    expect(JSON.stringify(body)).not.toMatch(/purchaseToken/);
  });

  test("a pending Play purchase is visible even before any entitlement exists", async () => {
    getPlaySubscriptionSummary.mockResolvedValueOnce({
      state: "pending", active: false, basePlanId: "edgecipline-pro-monthly", planType: "monthly",
      expiresAt: null, autoRenewing: false, cancelAtPeriodEnd: false, purchaseRef: "abcdef0123456789",
    });

    const body = await call(baseUser());

    expect(body.subscription.status).toBe("inactive");
    expect(body.subscription.state).toBe("pending");
    expect(body.isPremium).toBe(false);
  });

  test("a Razorpay-only subscriber gets no Play detail and never 'Renews' semantics", async () => {
    const body = await call(baseUser({
      subscriptionStatus: "active", subscriptionPlan: "monthly",
      subscriptionExpiry: new Date(Date.now() + 10 * ONE_DAY),
    }));
    expect(body.subscription).toMatchObject({ provider: "razorpay", cancelAtPeriodEnd: false, state: null, planLabel: "Monthly Pro" });
  });

  test("a failed Play lookup degrades to nulls instead of a 500", async () => {
    getPlaySubscriptionSummary.mockRejectedValueOnce(new Error("mongo down"));
    const body = await call(baseUser());
    expect(body.subscription.state).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("GET_ME_PLAY_LOOKUP_FAILED", expect.any(Object));
  });
});
