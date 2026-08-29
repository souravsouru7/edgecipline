"use strict";

jest.mock("../../models/Trade", () => ({ countDocuments: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ countDocuments: jest.fn() }));

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const quota = require("../../services/tradeQuotaService");

const USER_ID = "507f1f77bcf86cd799439011";
const freeUser = (over = {}) => ({ _id: USER_ID, role: "user", subscriptionStatus: "free", ...over });
const premiumUser = () => ({
  _id: USER_ID,
  role: "user",
  subscriptionStatus: "active",
  subscriptionPlan: "monthly",
  subscriptionExpiry: new Date(Date.now() + 30 * 864e5),
});
const trialUser = () => freeUser({ trial: { endsAt: new Date(Date.now() + 3 * 864e5) } });
const adminUser = () => freeUser({ role: "admin" });

function setCounts({ forex = 0, indian = 0 } = {}) {
  Trade.countDocuments.mockResolvedValue(forex);
  IndianTrade.countDocuments.mockResolvedValue(indian);
}

const attempt = async (args) => {
  try { return { ok: await quota.assertCanCreateTrades(args) }; }
  catch (error) { return { error }; }
};

beforeEach(() => jest.clearAllMocks());

describe("free allowance is 2 per market", () => {
  test("a brand-new free user may add a trade", async () => {
    setCounts({ forex: 0 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX });
    expect(error).toBeUndefined();
  });

  test("the 2nd trade is still allowed", async () => {
    setCounts({ forex: 1 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX });
    expect(error).toBeUndefined();
  });

  test("the 3rd trade is refused with 402 TRADE_LIMIT_REACHED", async () => {
    setCounts({ forex: 2 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX });
    expect(error.statusCode).toBe(402);
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
    expect(error.details.quota).toMatchObject({ limit: 2, used: 2, remaining: 0 });
  });

  test("an existing free user already far over the limit is refused", async () => {
    setCounts({ forex: 50 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX });
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
    expect(error.details.quota.remaining).toBe(0);
  });
});

describe("the two markets hold separate allowances", () => {
  test("using up Forex leaves the Indian allowance intact", async () => {
    setCounts({ forex: 2, indian: 0 });
    const { error } = await attempt({ user: freeUser(), market: quota.INDIAN });
    expect(error).toBeUndefined();
  });

  test("using up Indian leaves the Forex allowance intact", async () => {
    setCounts({ forex: 0, indian: 2 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX });
    expect(error).toBeUndefined();
  });

  test("each market counts its own collection only", async () => {
    setCounts({ forex: 0, indian: 0 });
    await attempt({ user: freeUser(), market: quota.INDIAN });
    expect(IndianTrade.countDocuments).toHaveBeenCalled();
    expect(Trade.countDocuments).not.toHaveBeenCalled();
  });
});

describe("premium bypasses the gate entirely", () => {
  test.each([
    ["paid subscriber", premiumUser],
    ["admin", adminUser],
  ])("%s is unlimited even at 500 trades", async (_label, build) => {
    setCounts({ forex: 500 });
    const { ok, error } = await attempt({ user: build(), market: quota.FOREX, count: 50 });
    expect(error).toBeUndefined();
    expect(ok.premium).toBe(true);
  });

  test("a premium check does not even hit the database", async () => {
    await attempt({ user: premiumUser(), market: quota.FOREX });
    expect(Trade.countDocuments).not.toHaveBeenCalled();
  });

  test("an expired subscription falls back to the free limit", async () => {
    setCounts({ forex: 2 });
    const expired = freeUser({
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: new Date(Date.now() - 864e5),
    });
    const { error } = await attempt({ user: expired, market: quota.FOREX });
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
  });

  test("a stale trial does NOT bypass the gate — the trial is retired", async () => {
    setCounts({ forex: 2 });
    const { error } = await attempt({ user: trialUser(), market: quota.FOREX });
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
  });

  test("an expired trial falls back to the free limit", async () => {
    setCounts({ forex: 2 });
    const lapsed = freeUser({ trial: { endsAt: new Date(Date.now() - 864e5), used: true } });
    const { error } = await attempt({ user: lapsed, market: quota.FOREX });
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
  });
});

describe("delete-and-re-add cannot reset the allowance", () => {
  test("the count query never filters on deletedAt", async () => {
    setCounts({ forex: 0 });
    await attempt({ user: freeUser(), market: quota.FOREX });
    const [query] = Trade.countDocuments.mock.calls[0];
    // Soft-deleted rows MUST be counted; excluding them would let a free user
    // delete a trade and immediately add another, forever.
    expect(query).not.toHaveProperty("deletedAt");
  });

  test("the Indian count query never filters on deletedAt either", async () => {
    setCounts({ indian: 0 });
    await attempt({ user: freeUser(), market: quota.INDIAN });
    const [query] = IndianTrade.countDocuments.mock.calls[0];
    expect(query).not.toHaveProperty("deletedAt");
  });
});

describe("multi-trade ghost rows do not consume the allowance", () => {
  test("Forex counting excludes ghost artifacts", async () => {
    setCounts({ forex: 0 });
    await attempt({ user: freeUser(), market: quota.FOREX });
    const [query] = Trade.countDocuments.mock.calls[0];
    expect(query["parsedData.multiTradeGhost"]).toEqual({ $ne: true });
  });
});

describe("batch imports are all-or-nothing", () => {
  test("a 5-trade import with 1 slot left is refused outright", async () => {
    setCounts({ forex: 1 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX, count: 5 });
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
    expect(error.details.requested).toBe(5);
    expect(error.details.quota.remaining).toBe(1);
  });

  test("a batch that exactly fills the allowance is accepted", async () => {
    setCounts({ forex: 0 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX, count: 2 });
    expect(error).toBeUndefined();
  });

  test("a batch one over the allowance is refused", async () => {
    setCounts({ forex: 0 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX, count: 3 });
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
  });

  test("the count is read inside the caller's transaction when one is given", async () => {
    const sessionAware = { session: jest.fn().mockResolvedValue(0) };
    Trade.countDocuments.mockReturnValue(sessionAware);
    const session = { id: "txn" };
    await attempt({ user: freeUser(), market: quota.FOREX, session });
    expect(sessionAware.session).toHaveBeenCalledWith(session);
  });
});

describe("input handling", () => {
  test.each([[0], [-1], [1.5], ["two"], [NaN]])("count %p is rejected as invalid", async (count) => {
    setCounts({ forex: 0 });
    const { error } = await attempt({ user: freeUser(), market: quota.FOREX, count });
    expect(error.errorCode).toBe("VALIDATION_ERROR");
  });

  test("a missing user is rejected before any query", async () => {
    const { error } = await attempt({ market: quota.FOREX });
    expect(error.errorCode).toBe("AUTH_REQUIRED");
    expect(Trade.countDocuments).not.toHaveBeenCalled();
  });

  test.each([
    ["Indian_Market", "Indian_Market"],
    ["indian", "Indian_Market"],
    ["Forex", "Forex"],
    ["", "Forex"],
    [undefined, "Forex"],
    ["nonsense", "Forex"],
  ])("market %p normalises to %p", (input, expected) => {
    expect(quota.normaliseMarket(input)).toBe(expected);
  });
});

describe("getQuota snapshot for the UI", () => {
  test("reports remaining entries for a free user", async () => {
    setCounts({ forex: 1 });
    expect(await quota.getQuota({ user: freeUser(), market: quota.FOREX }))
      .toMatchObject({ premium: false, limit: 2, used: 1, remaining: 1 });
  });

  test("never reports negative remaining for an over-limit user", async () => {
    setCounts({ forex: 50 });
    const snapshot = await quota.getQuota({ user: freeUser(), market: quota.FOREX });
    expect(snapshot.remaining).toBe(0);
    expect(snapshot.used).toBe(50);
  });

  test("reports premium with no limit", async () => {
    expect(await quota.getQuota({ user: premiumUser(), market: quota.INDIAN }))
      .toMatchObject({ premium: true, limit: null, remaining: null });
  });
});

describe("kill switch (FREE_TRADE_LIMIT_ENFORCED=false)", () => {
  // The gate must be provably inert when disabled, so the code can ship ahead
  // of checkout going live without stranding free users.
  function loadWithEnforcement(enforced) {
    let mod;
    jest.isolateModules(() => {
      jest.doMock("../../config", () => ({
        appConfig: {
          trades: { freeLimit: 2, freeLimitEnforced: enforced },
          razorpay: { keyId: "rzp_test" },
        },
      }));
      jest.doMock("../../models/Trade", () => ({ countDocuments: jest.fn().mockResolvedValue(500) }));
      jest.doMock("../../models/IndianTrade", () => ({ countDocuments: jest.fn().mockResolvedValue(500) }));
      mod = require("../../services/tradeQuotaService");
    });
    return mod;
  }

  test("a user at 500 trades is allowed through when enforcement is off", async () => {
    const disabled = loadWithEnforcement(false);
    await expect(
      disabled.assertCanCreateTrades({ user: freeUser(), market: "Forex", count: 10 })
    ).resolves.toMatchObject({ premium: true });
  });

  test("getQuota reports no limit when enforcement is off", async () => {
    const disabled = loadWithEnforcement(false);
    await expect(disabled.getQuota({ user: freeUser(), market: "Forex" }))
      .resolves.toMatchObject({ limit: null, remaining: null });
  });

  test("the same user IS blocked once enforcement is on", async () => {
    const enabled = loadWithEnforcement(true);
    await expect(
      enabled.assertCanCreateTrades({ user: freeUser(), market: "Forex" })
    ).rejects.toMatchObject({ errorCode: "TRADE_LIMIT_REACHED" });
  });
});
