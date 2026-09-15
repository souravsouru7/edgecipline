"use strict";

// Free-tier conversion funnel: T0 stamping, quota-in-response, lazy
// backfill, sheet dismissal, and the rule-based teaser. Everything is
// mocked at the model boundary, same as tradeQuota.test.js.

jest.mock("../../models/Trade", () => ({ countDocuments: jest.fn(), find: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ countDocuments: jest.fn(), find: jest.fn() }));
jest.mock("../../models/Users", () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  findById: jest.fn(),
}));
jest.mock("../../services/authCacheService", () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/analyticsEventService", () => ({ track: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const User = require("../../models/Users");
const { invalidateAuthCache } = require("../../services/authCacheService");
const analytics = require("../../services/analyticsEventService");
const quota = require("../../services/tradeQuotaService");
const funnel = require("../../services/freeTierFunnelService");

const USER_ID = "507f1f77bcf86cd799439011";
const freeUser = (over = {}) => ({
  _id: USER_ID,
  role: "user",
  subscriptionStatus: "inactive",
  totalPaid: 0,
  freeTier: { lastFreeTradeAt: null, exhaustedMarkets: [], lastFreeTradeSheetDismissedAt: null },
  ...over,
});
const paidUser = () => freeUser({
  subscriptionStatus: "active",
  subscriptionPlan: "monthly",
  subscriptionExpiry: new Date(Date.now() + 30 * 864e5),
  totalPaid: 349,
});
const lapsedUser = () => freeUser({
  subscriptionStatus: "expired",
  subscriptionExpiry: new Date(Date.now() - 30 * 864e5),
  totalPaid: 349,
});
const adminUser = () => freeUser({ role: "admin" });

function setCounts({ forex = 0, indian = 0 } = {}) {
  Trade.countDocuments.mockReturnValue(sessionAware(forex));
  IndianTrade.countDocuments.mockReturnValue(sessionAware(indian));
}

// countDocuments() returns a query that must also accept .session(); the
// service awaits it directly when no session is given.
function sessionAware(value) {
  const q = Promise.resolve(value);
  q.session = jest.fn().mockResolvedValue(value);
  return q;
}

// findOneAndUpdate returns a query with .session() and .lean().
function stampResult(freeTier) {
  const q = { session: jest.fn(), lean: jest.fn().mockResolvedValue(freeTier ? { freeTier } : null) };
  q.session.mockReturnValue(q);
  User.findOneAndUpdate.mockReturnValue(q);
  return q;
}

function findChain(rows) {
  const chain = {};
  for (const m of ["sort", "limit", "select"]) chain[m] = jest.fn().mockReturnValue(chain);
  chain.lean = jest.fn().mockResolvedValue(rows);
  return chain;
}

function setTrades({ forex = [], indian = [] } = {}) {
  Trade.find.mockReturnValue(findChain(forex));
  IndianTrade.find.mockReturnValue(findChain(indian));
}

beforeEach(() => {
  jest.clearAllMocks();
  User.updateOne.mockResolvedValue({ modifiedCount: 1 });
  setTrades();
});

describe("eligibility: who may enter the free-tier funnel", () => {
  test("a never-paid free user is eligible", () => {
    expect(funnel.isFunnelEligible(freeUser())).toBe(true);
  });

  test.each([
    ["paid subscriber", paidUser()],
    ["admin", adminUser()],
    ["lapsed subscriber (status expired)", lapsedUser()],
    ["past Play subscriber", freeUser({ playEntitlementExpiry: new Date(Date.now() - 864e5) })],
    ["refunded-but-recorded payment", freeUser({ totalPaid: 349 })],
    ["disabled account", freeUser({ accountStatus: "disabled" })],
    ["account pending deletion", freeUser({ pendingDeletion: true })],
  ])("%s is NOT eligible", (_label, user) => {
    expect(funnel.isFunnelEligible(user)).toBe(false);
  });

  test("a retired-trial user who never paid stays eligible", () => {
    const user = freeUser({ trial: { used: true, endsAt: new Date(Date.now() - 864e5) } });
    expect(funnel.isFunnelEligible(user)).toBe(true);
  });

  test("hasEverPaid distinguishes never-paid from lapsed", () => {
    expect(funnel.hasEverPaid(freeUser())).toBe(false);
    expect(funnel.hasEverPaid(lapsedUser())).toBe(true);
  });
});

describe("recordTradesCreated: quota in the create response + T0 stamp", () => {
  test("first free Forex trade → remaining 1, nothing stamped", async () => {
    setCounts({ forex: 1 });
    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.FOREX });
    expect(result.quota).toMatchObject({ market: "Forex", limit: 2, used: 1, remaining: 1, exhausted: false });
    expect(result.showLastFreeTradeSheet).toBe(false);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  test("second free Forex trade → remaining 0, T0 stamped, sheet requested", async () => {
    setCounts({ forex: 2 });
    const now = new Date("2026-09-14T10:00:00Z");
    stampResult({ lastFreeTradeAt: now, exhaustedMarkets: ["Forex"], lastFreeTradeSheetDismissedAt: null });

    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.FOREX, now });

    expect(result.quota).toMatchObject({ used: 2, remaining: 0, exhausted: true });
    expect(result.exhaustedNow).toBe(true);
    expect(result.showLastFreeTradeSheet).toBe(true);

    const [filter, pipeline] = User.findOneAndUpdate.mock.calls[0];
    // Only stamps when this market is not yet recorded — that is what makes
    // the return value mean "newly exhausted".
    expect(filter).toEqual({ _id: USER_ID, "freeTier.exhaustedMarkets": { $ne: "Forex" } });
    // lastFreeTradeAt is $ifNull'd so a later market never moves T0.
    expect(pipeline[0].$set["freeTier.lastFreeTradeAt"]).toEqual({ $ifNull: ["$freeTier.lastFreeTradeAt", now] });
    expect(pipeline[0].$set["freeTier.exhaustedMarkets"].$setUnion[1]).toEqual(["Forex"]);

    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_ID);
    expect(analytics.track).toHaveBeenCalledWith("free_allowance_exhausted", expect.objectContaining({
      userId: USER_ID,
      properties: expect.objectContaining({ market: "Forex", source: "create" }),
    }));
  });

  test("the sheet is NOT requested again once dismissed on another device", async () => {
    setCounts({ indian: 2 });
    stampResult({
      lastFreeTradeAt: new Date(), exhaustedMarkets: ["Forex", "Indian_Market"],
      lastFreeTradeSheetDismissedAt: new Date(),
    });
    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.INDIAN });
    expect(result.exhaustedNow).toBe(true);
    expect(result.showLastFreeTradeSheet).toBe(false);
  });

  test("a later request on an already-exhausted market does not re-stamp or re-fire", async () => {
    setCounts({ forex: 2 });
    stampResult(null); // filter matched nothing: market already recorded
    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.FOREX });
    expect(result.quota.exhausted).toBe(true);
    expect(result.exhaustedNow).toBe(false);
    expect(result.showLastFreeTradeSheet).toBe(false);
    expect(analytics.track).not.toHaveBeenCalled();
    expect(invalidateAuthCache).not.toHaveBeenCalled();
  });

  test("Forex exhausted while Indian remains available", async () => {
    setCounts({ forex: 2, indian: 0 });
    stampResult({ lastFreeTradeAt: new Date(), exhaustedMarkets: ["Forex"] });
    const forex = await funnel.recordTradesCreated({ user: freeUser(), market: quota.FOREX });
    expect(forex.exhaustedNow).toBe(true);

    User.findOneAndUpdate.mockClear();
    const indian = await funnel.recordTradesCreated({ user: freeUser(), market: quota.INDIAN });
    expect(indian.quota).toMatchObject({ market: "Indian_Market", remaining: 2, exhausted: false });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("Indian exhausted while Forex remains available", async () => {
    setCounts({ forex: 1, indian: 2 });
    stampResult({ lastFreeTradeAt: new Date(), exhaustedMarkets: ["Indian_Market"] });
    const indian = await funnel.recordTradesCreated({ user: freeUser(), market: quota.INDIAN });
    expect(indian.exhaustedNow).toBe(true);
    expect(User.findOneAndUpdate.mock.calls[0][0]["freeTier.exhaustedMarkets"]).toEqual({ $ne: "Indian_Market" });

    User.findOneAndUpdate.mockClear();
    const forex = await funnel.recordTradesCreated({ user: freeUser(), market: quota.FOREX });
    expect(forex.quota.remaining).toBe(1);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("both markets exhausted: second market is added, T0 untouched by the pipeline", async () => {
    const t0 = new Date("2026-09-01T00:00:00Z");
    setCounts({ forex: 2, indian: 2 });
    stampResult({ lastFreeTradeAt: t0, exhaustedMarkets: ["Forex", "Indian_Market"] });
    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.INDIAN, now: new Date() });
    expect(result.exhaustedNow).toBe(true);
    // The value written for lastFreeTradeAt is guarded by $ifNull, so the
    // pre-existing T0 wins inside MongoDB regardless of `now`.
    const pipeline = User.findOneAndUpdate.mock.calls[0][1];
    expect(pipeline[0].$set["freeTier.lastFreeTradeAt"].$ifNull[0]).toBe("$freeTier.lastFreeTradeAt");
  });

  test("batch import that consumes both slots stamps inside the caller's session", async () => {
    const session = { id: "txn" };
    setCounts({ indian: 2 });
    const stamp = stampResult({ lastFreeTradeAt: new Date(), exhaustedMarkets: ["Indian_Market"] });

    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.INDIAN, session });

    expect(result.exhaustedNow).toBe(true);
    // Count read inside the transaction…
    expect(IndianTrade.countDocuments.mock.results[0].value.session).toHaveBeenCalledWith(session);
    // …and the User stamp written inside it too.
    expect(stamp.session).toHaveBeenCalledWith(session);
  });

  test.each([
    ["paid user", paidUser()],
    ["admin", adminUser()],
  ])("%s gets a premium quota and no funnel state", async (_label, user) => {
    setCounts({ forex: 500 });
    const result = await funnel.recordTradesCreated({ user, market: quota.FOREX });
    expect(result.quota).toMatchObject({ premium: true, limit: null, exhausted: false });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a lapsed subscriber at the free limit is never stamped into this funnel", async () => {
    setCounts({ forex: 2 });
    const result = await funnel.recordTradesCreated({ user: lapsedUser(), market: quota.FOREX });
    expect(result.quota.exhausted).toBe(true);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  test("a failed stamp never fails the trade that was already saved", async () => {
    setCounts({ forex: 2 });
    const q = { session: jest.fn(), lean: jest.fn().mockRejectedValue(new Error("mongo down")) };
    q.session.mockReturnValue(q);
    User.findOneAndUpdate.mockReturnValue(q);
    const result = await funnel.recordTradesCreated({ user: freeUser(), market: quota.FOREX });
    expect(result.quota.exhausted).toBe(true);
    expect(result.exhaustedNow).toBe(false);
  });
});

describe("enforcement disabled: no funnel state at all", () => {
  function loadDisabled() {
    let mod;
    jest.isolateModules(() => {
      jest.doMock("../../config", () => ({
        appConfig: { trades: { freeLimit: 2, freeLimitEnforced: false }, razorpay: { keyId: "rzp_test" } },
      }));
      mod = require("../../services/freeTierFunnelService");
    });
    return mod;
  }

  test("a user at 500 trades is not eligible and is never stamped", async () => {
    const disabled = loadDisabled();
    setCounts({ forex: 500 });
    expect(disabled.isFunnelEligible(freeUser())).toBe(false);
    const result = await disabled.recordTradesCreated({ user: freeUser(), market: "Forex" });
    expect(result.quota).toMatchObject({ premium: true, limit: null });
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("lazy backfill for accounts exhausted before the funnel shipped", () => {
  test("used >= limit with no T0 → stamps and fires once with source=backfill", async () => {
    const snapshot = { market: "Forex", premium: false, limit: 2, used: 2, remaining: 0, exhausted: true };
    stampResult({ lastFreeTradeAt: new Date(), exhaustedMarkets: ["Forex"] });
    const stamped = await funnel.backfillExhaustedState({ user: freeUser(), market: quota.FOREX, quota: snapshot });
    expect(stamped.exhaustedMarkets).toEqual(["Forex"]);
    expect(analytics.track).toHaveBeenCalledWith("free_allowance_exhausted", expect.objectContaining({
      properties: expect.objectContaining({ source: "backfill", market: "Forex" }),
    }));
  });

  test("repeated quota calls do not re-stamp when the market is already recorded", async () => {
    const snapshot = { market: "Forex", premium: false, limit: 2, used: 2, remaining: 0, exhausted: true };
    const user = freeUser({ freeTier: { lastFreeTradeAt: new Date(), exhaustedMarkets: ["Forex"] } });
    const stamped = await funnel.backfillExhaustedState({ user, market: quota.FOREX, quota: snapshot });
    expect(stamped).toBeNull();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("a stale cache that misses the market is harmless: the conditional update no-ops", async () => {
    const snapshot = { market: "Forex", premium: false, limit: 2, used: 2, remaining: 0, exhausted: true };
    stampResult(null);
    const stamped = await funnel.backfillExhaustedState({ user: freeUser(), market: quota.FOREX, quota: snapshot });
    expect(stamped).toBeNull();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  test("a user with free trades remaining is never backfilled", async () => {
    const snapshot = { market: "Forex", premium: false, limit: 2, used: 1, remaining: 1, exhausted: false };
    expect(await funnel.backfillExhaustedState({ user: freeUser(), market: quota.FOREX, quota: snapshot })).toBeNull();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test.each([["paid", paidUser()], ["admin", adminUser()], ["lapsed", lapsedUser()]])(
    "%s user is never backfilled",
    async (_l, user) => {
      const snapshot = { market: "Forex", premium: false, limit: 2, used: 2, remaining: 0, exhausted: true };
      expect(await funnel.backfillExhaustedState({ user, market: quota.FOREX, quota: snapshot })).toBeNull();
    }
  );
});

describe("firstBlockedAt + sheet dismissal", () => {
  test("the 402 gate records the first refusal only", async () => {
    setCounts({ forex: 2 });
    await expect(quota.assertCanCreateTrades({ user: freeUser(), market: quota.FOREX }))
      .rejects.toMatchObject({ errorCode: "TRADE_LIMIT_REACHED" });
    // recordBlocked is fire-and-forget; give the microtask a tick.
    await new Promise((r) => setImmediate(r));
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: USER_ID, "freeTier.firstBlockedAt": null },
      { $set: { "freeTier.firstBlockedAt": expect.any(Date) } }
    );
  });

  test("the 402 body carries the exhausted flag", async () => {
    setCounts({ forex: 2 });
    await expect(quota.assertCanCreateTrades({ user: freeUser(), market: quota.FOREX }))
      .rejects.toMatchObject({ details: { quota: { exhausted: true } } });
  });

  test("dismissing the sheet is a conditional write and invalidates the cache", async () => {
    await funnel.dismissLastFreeTradeSheet(USER_ID);
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: USER_ID, "freeTier.lastFreeTradeSheetDismissedAt": null },
      { $set: { "freeTier.lastFreeTradeSheetDismissedAt": expect.any(Date) } }
    );
    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_ID);
  });

  test("a second dismissal is a no-op", async () => {
    User.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await funnel.dismissLastFreeTradeSheet(USER_ID);
    expect(invalidateAuthCache).not.toHaveBeenCalled();
  });
});

describe("teaser insight (rule-based, no AI)", () => {
  const t = (over) => ({ symbol: "EURUSD", side: "BUY", pnl: 10, market: "Forex", date: null, ...over });

  test("no live trades → safe fallback that names no count", () => {
    const teaser = funnel.buildTeaserInsight([]);
    expect(teaser.code).toBe("fallback");
    expect(teaser.text).toBe("Your trading history contains a pattern worth exploring — unlock to see it.");
    expect(teaser.locked).toBe(true);
  });

  test("one live trade (the other was deleted) never says 'two'", () => {
    const teaser = funnel.buildTeaserInsight([t({ symbol: "GBPJPY" })]);
    expect(teaser.code).toBe("single_trade");
    expect(teaser.text).toMatch(/GBPJPY/);
    expect(teaser.text).not.toMatch(/two|2 /i);
  });

  test("same pair wins over everything else", () => {
    const teaser = funnel.buildTeaserInsight([t({ side: "BUY", pnl: 5 }), t({ side: "SELL", pnl: -5 })]);
    expect(teaser.code).toBe("same_pair");
    expect(teaser.text).toBe("Your two EURUSD trades share a pattern — unlock to see it.");
  });

  test("same direction", () => {
    const teaser = funnel.buildTeaserInsight([t({ symbol: "EURUSD", side: "SELL", pnl: 5 }), t({ symbol: "XAUUSD", side: "SELL", pnl: -5 })]);
    expect(teaser.code).toBe("same_direction");
    expect(teaser.text).toBe("Both trades leaned the same way — there's a pattern worth checking.");
  });

  test("one-sided results", () => {
    const teaser = funnel.buildTeaserInsight([t({ symbol: "A", side: "BUY", pnl: -5 }), t({ symbol: "B", side: "SELL", pnl: -8 })]);
    expect(teaser.code).toBe("pnl_pattern");
  });

  test("mixed everything → generic", () => {
    const teaser = funnel.buildTeaserInsight([t({ symbol: "A", side: "BUY", pnl: 5 }), t({ symbol: "B", side: "SELL", pnl: -8 })]);
    expect(teaser.code).toBe("generic");
    expect(teaser.text).toBe("Your recent trades share a pattern — unlock to see it.");
  });

  test("counts of three and four are spelled out", () => {
    const four = funnel.buildTeaserInsight([t(), t(), t(), t()]);
    expect(four.text).toMatch(/four EURUSD trades/);
  });

  test("is deterministic", () => {
    const input = [t({ symbol: "A", side: "BUY", pnl: 5 }), t({ symbol: "B", side: "SELL", pnl: -8 })];
    expect(funnel.buildTeaserInsight(input)).toEqual(funnel.buildTeaserInsight(input));
  });
});

describe("context builder", () => {
  const row = (over) => ({
    _id: "t1", pair: "EURUSD", type: "BUY", profit: 12.5, strategy: "ORB",
    effectiveTradeDate: new Date("2026-09-10T00:00:00Z"), parsedData: { notes: "secret" }, ...over,
  });

  test("exposes display fields only and excludes ghost + deleted rows by query", async () => {
    setTrades({ forex: [row()], indian: [] });
    const ctx = await funnel.buildFreeTierContext(freeUser({ streaks: { journal: { current: 4 } } }));
    expect(ctx.recentTrades).toHaveLength(1);
    expect(ctx.recentTrades[0]).toEqual({
      id: "t1", market: "Forex", symbol: "EURUSD", side: "BUY", pnl: 12.5,
      date: "2026-09-10T00:00:00.000Z", strategy: "ORB", optionType: null,
    });
    expect(ctx.recentTrades[0]).not.toHaveProperty("parsedData");
    const [forexQuery] = Trade.find.mock.calls[0];
    expect(forexQuery).toMatchObject({ deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } });
    const [indianQuery] = IndianTrade.find.mock.calls[0];
    expect(indianQuery).toMatchObject({ deletedAt: null });
    expect(ctx.disciplineStreak).toBe(4);
  });

  test("merges both markets newest-first and caps at four", async () => {
    setTrades({
      forex: [row({ _id: "f1", effectiveTradeDate: new Date("2026-09-01") }), row({ _id: "f2", effectiveTradeDate: new Date("2026-09-05") })],
      indian: [
        row({ _id: "i1", pair: "NIFTY 24000 CE", optionType: "CE", effectiveTradeDate: new Date("2026-09-09") }),
        row({ _id: "i2", pair: "BANKNIFTY 50000 PE", optionType: "PE", effectiveTradeDate: new Date("2026-09-03") }),
        row({ _id: "i3", effectiveTradeDate: new Date("2026-08-01") }),
      ],
    });
    const ctx = await funnel.buildFreeTierContext(freeUser({ streaks: {} }));
    expect(ctx.recentTrades.map((t) => t.id)).toEqual(["i1", "f2", "i2", "f1"]);
    expect(ctx.recentTrades[0].optionType).toBe("CE");
    expect(ctx.tradesLogged).toBe(4);
  });

  test("falls back cleanly when both trades were deleted", async () => {
    setTrades();
    const ctx = await funnel.buildFreeTierContext(freeUser({ streaks: {} }));
    expect(ctx.recentTrades).toEqual([]);
    expect(ctx.tradesLogged).toBe(0);
    expect(ctx.primaryTrade).toBeNull();
    expect(ctx.teaserInsight.code).toBe("fallback");
    expect(ctx.offer).toBeNull();
  });

  test("a slow collection degrades to no trades rather than throwing", async () => {
    const chain = findChain([]);
    chain.lean.mockRejectedValue(new Error("timeout"));
    Trade.find.mockReturnValue(chain);
    IndianTrade.find.mockReturnValue(findChain([row({ _id: "i1" })]));
    const ctx = await funnel.buildFreeTierContext(freeUser({ streaks: {} }));
    expect(ctx.recentTrades.map((t) => t.id)).toEqual(["i1"]);
  });

  test("fetches streaks + freeTier when handed the projected auth-cache user", async () => {
    const chain = { select: jest.fn(), lean: jest.fn().mockResolvedValue({
      streaks: { rule: { current: 6 } }, freeTier: { exhaustedMarkets: ["Indian_Market"] },
    }) };
    chain.select.mockReturnValue(chain);
    User.findById.mockReturnValue(chain);
    setTrades({ forex: [row()] });
    const ctx = await funnel.buildFreeTierContext({ _id: USER_ID, name: "Alex Trader" });
    expect(User.findById).toHaveBeenCalledWith(USER_ID);
    expect(ctx.disciplineStreak).toBe(6);
    expect(ctx.primaryMarket).toBe("Indian_Market");
    expect(ctx.primaryMarketLabel).toBe("Indian market");
    expect(ctx.name).toBe("Alex");
  });

  test("never touches an AI or network service", () => {
    const src = require("fs").readFileSync(require.resolve("../../services/freeTierFunnelService"), "utf8");
    expect(src).not.toMatch(/gemini|openai|anthropic|fetch\(|axios/i);
  });
});
