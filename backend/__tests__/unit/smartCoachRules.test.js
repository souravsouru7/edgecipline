/**
 * All eight Smart Coach rules, for both markets, against mocked collections.
 *
 * What each rule is checked for: trigger condition, non-trigger, market
 * isolation (Forex data never satisfies an Indian check and vice versa),
 * dedupe key shape, deep link per market, preference gate reached via
 * notifyUser, and that the heavy checks are the ones the worker runs.
 */

function chainable(result) {
  const chain = {};
  for (const m of ["sort", "limit", "select"]) chain[m] = jest.fn(() => chain);
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  chain.lean = jest.fn(() => Promise.resolve(result));
  return chain;
}

// jest.mock factories cannot close over helpers; build inert models here and
// give them real behaviour in beforeEach.
jest.mock("../../models/Trade", () => ({ countDocuments: jest.fn(), find: jest.fn(), aggregate: jest.fn(), findById: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ countDocuments: jest.fn(), find: jest.fn(), aggregate: jest.fn(), findById: jest.fn() }));
jest.mock("../../models/NotificationDebugLog", () => ({
  findOneAndUpdate: jest.fn(() => ({ catch: jest.fn() })),
}));
// The evaluator looks up the user's own timezone when the caller passes none.
jest.mock("../../models/Users", () => ({
  findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ streaks: { timezone: "Europe/London" } }) }) })),
}));
jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "n1", status: "sent" }),
}));
jest.mock("../../queues/smartNotificationQueue", () => ({
  enqueueSmartNotificationChecks: jest.fn().mockResolvedValue({ id: "sn-1" }),
}));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const notificationService = require("../../services/notificationService");
const Users = require("../../models/Users");
const { enqueueSmartNotificationChecks } = require("../../queues/smartNotificationQueue");
const { evaluateSmartNotifications, runAsyncChecks, formatMoney } = require("../../services/smartNotificationEvaluator");

const USER = "507f1f77bcf86cd799439011";
const TZ = "Asia/Kolkata";
// Monday 2026-09-21 11:00 IST
const NOW = new Date("2026-09-21T05:30:00.000Z");

const MARKETS = {
  forex:  { marketType: "Forex",         collection: "forex",  Model: () => Trade,       root: "" },
  indian: { marketType: "Indian_Market", collection: "indian", Model: () => IndianTrade, root: "/indian-market" },
};

function trade(overrides = {}) {
  return {
    _id: "64b000000000000000000001",
    pair: "EURUSD",
    profit: 10,
    stopLoss: 1.08,
    setupScore: 80,
    tradeDate: NOW,
    createdAt: NOW,
    mood: 4,
    emotionalTags: [],
    confidence: "Medium",
    mistakeTag: "",
    ...overrides,
  };
}

function sentTypes() {
  return notificationService.notifyUser.mock.calls.map(([, p]) => p.type);
}
function sentPayload(type) {
  return notificationService.notifyUser.mock.calls.find(([, p]) => p.type === type)?.[1];
}

// The user's own limits for one market, as stored on Users.riskLimits.
function setLimits(marketType, limits) {
  Users.findById.mockImplementation(() => ({
    select: () => ({
      lean: async () => ({ streaks: { timezone: "Europe/London" }, riskLimits: { [marketType]: limits } }),
    }),
  }));
}

async function runAll(market, t) {
  const payload = { userId: USER, trade: t, marketType: market.marketType, collection: market.collection, timezone: TZ };
  await evaluateSmartNotifications(payload);          // sync checks + enqueue
  await runAsyncChecks(payload);                      // what the worker runs
}

beforeEach(() => {
  jest.clearAllMocks();
  // Fixtures are dated NOW; the evaluator ignores trades older than 36h.
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
  // No limits set unless a test says so (clearAllMocks keeps implementations).
  Users.findById.mockImplementation(() => ({
    select: () => ({ lean: async () => ({ streaks: { timezone: "Europe/London" } }) }),
  }));
  for (const M of [Trade, IndianTrade]) {
    M.countDocuments.mockResolvedValue(0);
    M.find.mockImplementation(() => chainable([]));
    M.aggregate.mockResolvedValue([]);
  }
});

describe("evaluateSmartNotifications split", () => {
  it("runs the 3 fast checks inline and hands the 5 heavy checks to the queue", async () => {
    await evaluateSmartNotifications({ userId: USER, trade: trade({ stopLoss: null }), marketType: "Forex", collection: "forex", timezone: TZ });
    expect(sentTypes()).toEqual(["no_stop_loss"]);
    expect(enqueueSmartNotificationChecks).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, tradeId: "64b000000000000000000001", collection: "forex", marketType: "Forex", timezone: TZ,
    }));
  });

  it("never throws into the trade-save path when the queue is down", async () => {
    enqueueSmartNotificationChecks.mockRejectedValueOnce(new Error("redis down"));
    await expect(evaluateSmartNotifications({ userId: USER, trade: trade(), marketType: "Forex", collection: "forex" })).resolves.toBeUndefined();
  });

  it("runAsyncChecks rejects when any heavy check rejects so BullMQ retries", async () => {
    notificationService.notifyUser.mockRejectedValueOnce(new Error("fcm transient"));
    Trade.find.mockImplementation(() => chainable([{ profit: -5 }, { profit: -5 }, { profit: -5 }].map((p) => ({ ...p, tradeDate: NOW }))));
    await expect(runAsyncChecks({ userId: USER, trade: trade({ profit: -5 }), marketType: "Forex", collection: "forex", timezone: TZ }))
      .rejects.toThrow(/smart notification check\(s\) failed/);
  });
});

describe.each(Object.entries(MARKETS))("rule 1 · no_stop_loss (%s)", (_name, market) => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty string", ""],
    ["non-numeric", "abc"],
    ["zero", 0],
    ["negative", -1.05],
  ])("fires when stopLoss is %s", async (_label, stopLoss) => {
    await runAll(market, trade({ stopLoss }));
    const p = sentPayload("no_stop_loss");
    expect(p).toBeDefined();
    expect(p.dedupeKey).toBe("no-stop-loss:64b000000000000000000001");
    expect(p.deepLink).toBe(`${market.root}/trades/edit?id=64b000000000000000000001`);
    expect(p.data.marketType).toBe(market.marketType);
  });

  it("does not fire with a valid stop loss", async () => {
    await runAll(market, trade({ stopLoss: 1.08 }));
    expect(sentTypes()).not.toContain("no_stop_loss");
  });

  it("separate trades get separate alerts (dedupe is per trade, not per day)", async () => {
    await runAll(market, trade({ _id: "64b000000000000000000001", stopLoss: null }));
    await runAll(market, trade({ _id: "64b000000000000000000002", stopLoss: null }));
    const keys = notificationService.notifyUser.mock.calls.filter(([, p]) => p.type === "no_stop_loss").map(([, p]) => p.dedupeKey);
    expect(new Set(keys).size).toBe(2);
  });
});

describe.each(Object.entries(MARKETS))("rule 2 · setup_discipline (%s)", (_name, market) => {
  it("fires immediately on a critical score (<40)", async () => {
    await runAll(market, trade({ setupScore: 35, profit: 20 }));
    const p = sentPayload("setup_discipline");
    expect(p.dedupeKey).toBe(`setup-discipline:${USER}:${market.marketType}:2026-09-21:1`);
    expect(p.deepLink).toBe(`${market.root}/trades/view?id=64b000000000000000000001`);
  });

  it("fires on a sub-60 loss", async () => {
    await runAll(market, trade({ setupScore: 55, profit: -20 }));
    expect(sentTypes()).toContain("setup_discipline");
  });

  it("fires on the 2nd sub-60 trade of the day even if it won", async () => {
    market.Model().countDocuments.mockResolvedValue(2);
    await runAll(market, trade({ setupScore: 55, profit: 20 }));
    expect(sentTypes()).toContain("setup_discipline");
  });

  it("does not fire on a single sub-60 win", async () => {
    market.Model().countDocuments.mockResolvedValue(1);
    await runAll(market, trade({ setupScore: 55, profit: 20 }));
    expect(sentTypes()).not.toContain("setup_discipline");
  });

  it("does not fire at or above 60", async () => {
    await runAll(market, trade({ setupScore: 60, profit: -20 }));
    expect(sentTypes()).not.toContain("setup_discipline");
  });

  it("counts only its own market's trades", async () => {
    await runAll(market, trade({ setupScore: 55, profit: 20 }));
    const other = market === MARKETS.forex ? IndianTrade : Trade;
    expect(other.countDocuments).not.toHaveBeenCalled();
  });
});

describe("rule 3 · mood_risk (user-level, cross-market by design)", () => {
  it.each([
    ["low mood", { mood: 2 }],
    ["risk tag", { emotionalTags: ["FOMO"] }],
    ["overconfident", { confidence: "Overconfident" }],
  ])("fires on %s with a per-user-per-day key", async (_label, extra) => {
    await runAll(MARKETS.indian, trade(extra));
    const p = sentPayload("mood_risk");
    expect(p.dedupeKey).toBe(`mood-risk:${USER}:2026-09-21`);
    expect(p.deepLink).toBe("/checklist/psychology");
  });

  it("does not fire for a calm, confident trade", async () => {
    await runAll(MARKETS.forex, trade({ mood: 4, emotionalTags: ["Calm"], confidence: "High" }));
    expect(sentTypes()).not.toContain("mood_risk");
  });
});

describe.each(Object.entries(MARKETS))("rule 4 · revenge_trading (%s)", (_name, market) => {
  const losses = (spanHours) => [
    { profit: -10, tradeDate: NOW },
    { profit: -10, tradeDate: new Date(NOW.getTime() - (spanHours / 2) * 3600e3) },
    { profit: -10, tradeDate: new Date(NOW.getTime() - spanHours * 3600e3) },
  ];

  it("fires on 3 consecutive losses within 4h", async () => {
    market.Model().find.mockImplementation(() => chainable(losses(2)));
    await runAll(market, trade({ profit: -10 }));
    const p = sentPayload("revenge_trading");
    expect(p.dedupeKey).toBe(`revenge-warning:${USER}:${market.marketType}:2026-09-21`);
    expect(p.deepLink).toBe(`${market.root}/trades?filter=today`);
    expect(p.body).toContain(market.collection === "indian" ? "−₹30.00" : "−$30.00");
  });

  it("does not fire when the losses span more than 4h", async () => {
    market.Model().find.mockImplementation(() => chainable(losses(5)));
    await runAll(market, trade({ profit: -10 }));
    expect(sentTypes()).not.toContain("revenge_trading");
  });

  it("does not fire when only 2 of the last 3 lost", async () => {
    market.Model().find.mockImplementation(() => chainable([{ profit: -10, tradeDate: NOW }, { profit: 5, tradeDate: NOW }, { profit: -10, tradeDate: NOW }]));
    await runAll(market, trade({ profit: -10 }));
    expect(sentTypes()).not.toContain("revenge_trading");
  });

  it("does not fire when the current trade won", async () => {
    market.Model().find.mockImplementation(() => chainable(losses(1)));
    await runAll(market, trade({ profit: 10 }));
    expect(sentTypes()).not.toContain("revenge_trading");
  });

  it("ignores losses in the other market", async () => {
    const other = market === MARKETS.forex ? IndianTrade : Trade;
    other.find.mockImplementation(() => chainable(losses(1)));
    await runAll(market, trade({ profit: -10 }));
    expect(sentTypes()).not.toContain("revenge_trading");
    expect(other.find).not.toHaveBeenCalled();
  });
});

describe.each(Object.entries(MARKETS))("rule 5 · overtrading (%s)", (_name, market) => {
  const history = [{ count: 2 }, { count: 2 }, { count: 2 }]; // avg 2 → threshold max(3,4,5)=5

  it("fires when today exceeds the adaptive threshold", async () => {
    market.Model().aggregate.mockResolvedValue(history);
    market.Model().countDocuments.mockResolvedValue(6);
    await runAll(market, trade());
    const p = sentPayload("overtrading");
    expect(p.dedupeKey).toBe(`overtrading:${USER}:${market.marketType}:2026-09-21`);
    expect(p.data.threshold).toBe("5");
    expect(p.deepLink).toBe(`${market.root}/trades?filter=today`);
  });

  it("does not fire at exactly the threshold", async () => {
    market.Model().aggregate.mockResolvedValue(history);
    market.Model().countDocuments.mockResolvedValue(5);
    await runAll(market, trade());
    expect(sentTypes()).not.toContain("overtrading");
  });

  it("does not fire with fewer than 3 trading days of history", async () => {
    market.Model().aggregate.mockResolvedValue([{ count: 1 }, { count: 1 }]);
    market.Model().countDocuments.mockResolvedValue(50);
    await runAll(market, trade());
    expect(sentTypes()).not.toContain("overtrading");
  });

  it("re-uses the same dedupe key on the 7th, 8th… trade so notifyUser dedupes", async () => {
    market.Model().aggregate.mockResolvedValue(history);
    market.Model().countDocuments.mockResolvedValue(7);
    await runAll(market, trade({ _id: "64b000000000000000000007" }));
    market.Model().countDocuments.mockResolvedValue(8);
    await runAll(market, trade({ _id: "64b000000000000000000008" }));
    const keys = notificationService.notifyUser.mock.calls.filter(([, p]) => p.type === "overtrading").map(([, p]) => p.dedupeKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });
});

describe.each(Object.entries(MARKETS))("rule 6 · repeated_mistake (%s)", (_name, market) => {
  it("fires on the 3rd occurrence this week and routes to the market's own analytics", async () => {
    market.Model().countDocuments.mockResolvedValue(3);
    await runAll(market, trade({ mistakeTag: "Chased Entry" }));
    const p = sentPayload("repeated_mistake");
    expect(p.dedupeKey).toBe(`repeated-mistake:${USER}:${market.marketType}:2026-09-21:chased_entry`);
    expect(p.deepLink).toBe(`${market.root}/analytics?insight=mistakes&tag=chased_entry`);
    expect(p.data.screen).toBe(market === MARKETS.forex ? "analytics" : "indian-analytics");
  });

  it("matches the tag case-insensitively", async () => {
    market.Model().countDocuments.mockResolvedValue(3);
    await runAll(market, trade({ mistakeTag: "fomo" }));
    const call = market.Model().countDocuments.mock.calls.find(([q]) => q.mistakeTag);
    expect(call[0].mistakeTag).toEqual(/^fomo$/i);
  });

  it("does not fire below 3", async () => {
    market.Model().countDocuments.mockResolvedValue(2);
    await runAll(market, trade({ mistakeTag: "fomo" }));
    expect(sentTypes()).not.toContain("repeated_mistake");
  });

  it("does not fire without a tag", async () => {
    market.Model().countDocuments.mockResolvedValue(9);
    await runAll(market, trade({ mistakeTag: "  " }));
    expect(sentTypes()).not.toContain("repeated_mistake");
  });
});

describe.each(Object.entries(MARKETS))("rule 7 · daily_loss_warning against the user's limit (%s)", (_name, market) => {
  const day = (profits) => market.Model().find.mockImplementation(() => chainable(profits.map((profit) => ({ profit }))));
  const sym = market === MARKETS.indian ? "₹" : "$";
  const lossCalls = () => notificationService.notifyUser.mock.calls.filter(([, p]) => p.type === "daily_loss_warning").map(([, p]) => p);

  it("never fires without a limit — two small losses used to trigger it", async () => {
    setLimits(market.marketType, { dailyLossLimit: null });
    day([-5, -5]);
    await runAll(market, trade({ profit: -5 }));
    day([-500, -500, -500]);
    await runAll(market, trade({ profit: -500 }));
    expect(lossCalls()).toHaveLength(0);
  });

  it("stays silent below 80% of the limit", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([-40, -39]); // 79%
    await runAll(market, trade({ profit: -39 }));
    expect(lossCalls()).toHaveLength(0);
  });

  it("warns at 80% with the market's currency", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([-50, -30]);
    await runAll(market, trade({ profit: -30 }));
    const [p] = lossCalls();
    expect(p.title).toBe("Close to your daily loss limit.");
    expect(p.body).toContain(`−${sym}80.00 today, 80% of your ${sym}100.00 limit`);
    expect(p.dedupeKey).toBe(`daily-loss:80:${USER}:${market.marketType}:2026-09-21`);
    expect(p.deepLink).toBe(`${market.root}/trades?filter=today`);
    expect(p.priority).toBe("high");
  });

  it("says 'limit hit' at exactly 100%", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([-60, -40]);
    await runAll(market, trade({ profit: -40 }));
    const [p] = lossCalls();
    expect(p.title).toBe("Daily loss limit hit.");
    expect(p.dedupeKey).toBe(`daily-loss:100:${USER}:${market.marketType}:2026-09-21`);
    expect(p.data.level).toBe("100");
  });

  it("one trade jumping past 100% sends only 'hit', not the 80% warning", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([-250]);
    await runAll(market, trade({ profit: -250 }));
    expect(lossCalls().map((p) => p.data.level)).toEqual(["100"]);
  });

  it("fires on a single big losing trade (no 2-trade minimum any more)", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([-90]);
    await runAll(market, trade({ profit: -90 }));
    expect(lossCalls().map((p) => p.data.level)).toEqual(["80"]);
  });

  it("counts wins: net P&L, not just the losses", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([200, -150, -100]); // net -50
    await runAll(market, trade({ profit: -100 }));
    expect(lossCalls()).toHaveLength(0);
  });

  it("does not fire on a winning trade or a trade without P&L", async () => {
    setLimits(market.marketType, { dailyLossLimit: 10 });
    day([-500]);
    await runAll(market, trade({ profit: 10 }));
    await runAll(market, trade({ profit: null }));
    expect(lossCalls()).toHaveLength(0);
  });

  it("re-uses the same key for the same level so notifyUser dedupes it", async () => {
    setLimits(market.marketType, { dailyLossLimit: 100 });
    day([-85]);
    await runAll(market, trade({ profit: -85, _id: "64b000000000000000000002" }));
    day([-85, -5]);
    await runAll(market, trade({ profit: -5, _id: "64b000000000000000000003" }));
    const keys = lossCalls().map((p) => p.dedupeKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("ignores the other market's limit and trades", async () => {
    const otherType = market === MARKETS.forex ? "Indian_Market" : "Forex";
    setLimits(otherType, { dailyLossLimit: 1 });
    const other = market === MARKETS.forex ? IndianTrade : Trade;
    other.find.mockImplementation(() => chainable([{ profit: -100 }, { profit: -100 }]));
    day([-50]);
    await runAll(market, trade({ profit: -50 }));
    expect(lossCalls()).toHaveLength(0);
  });

  it("ignores garbage stored as a limit", async () => {
    for (const bad of [0, -100, "abc", NaN]) {
      setLimits(market.marketType, { dailyLossLimit: bad });
      day([-1000]);
      await runAll(market, trade({ profit: -1000 }));
    }
    expect(lossCalls()).toHaveLength(0);
  });

  it("a failed limits read skips the check without failing the other checks", async () => {
    Users.findById.mockImplementation(() => { throw new Error("mongo down"); });
    day([-1000]);
    await expect(runAsyncChecks({ userId: USER, trade: trade({ profit: -1000 }), marketType: market.marketType, collection: market.collection, timezone: TZ }))
      .resolves.toEqual(expect.objectContaining({ dailyLossWarning: "fulfilled" }));
    expect(lossCalls()).toHaveLength(0);
  });
});

describe.each(Object.entries(MARKETS))("rule 5b · max trades per day set by the user (%s)", (_name, market) => {
  const tradeCalls = () => notificationService.notifyUser.mock.calls.filter(([, p]) => p.type === "overtrading").map(([, p]) => p);

  it("is silent below the limit", async () => {
    setLimits(market.marketType, { maxTradesPerDay: 5 });
    market.Model().countDocuments.mockResolvedValue(4);
    await runAll(market, trade());
    expect(tradeCalls()).toHaveLength(0);
  });

  it("says 'limit reached' on the trade that reaches it", async () => {
    setLimits(market.marketType, { maxTradesPerDay: 5 });
    market.Model().countDocuments.mockResolvedValue(5);
    await runAll(market, trade());
    const [p] = tradeCalls();
    expect(p.title).toBe("Trade limit reached.");
    expect(p.body).toContain("5 of your 5 trades");
    expect(p.dedupeKey).toBe(`trade-limit:reached:${USER}:${market.marketType}:2026-09-21`);
    expect(p.data.limitSource).toBe("user");
  });

  it("says 'over your limit' past it, once per day", async () => {
    setLimits(market.marketType, { maxTradesPerDay: 5 });
    market.Model().countDocuments.mockResolvedValue(6);
    await runAll(market, trade({ _id: "64b000000000000000000006" }));
    market.Model().countDocuments.mockResolvedValue(7);
    await runAll(market, trade({ _id: "64b000000000000000000007" }));
    const keys = tradeCalls().map((p) => p.dedupeKey);
    expect(new Set(keys)).toEqual(new Set([`trade-limit:over:${USER}:${market.marketType}:2026-09-21`]));
  });

  it("counts every trade, including ones without P&L (no profit filter)", async () => {
    setLimits(market.marketType, { maxTradesPerDay: 2 });
    market.Model().countDocuments.mockResolvedValue(2);
    await runAll(market, trade({ profit: null }));
    const query = market.Model().countDocuments.mock.calls.map(([q]) => q).find((q) => q.tradeDate && !q.mistakeTag && !q.setupScore && !q.profit);
    expect(query).toBeDefined();
    expect(tradeCalls()).toHaveLength(1);
  });

  it("skips the average-based guess when a limit is set", async () => {
    setLimits(market.marketType, { maxTradesPerDay: 20 });
    market.Model().aggregate.mockResolvedValue([{ count: 2 }, { count: 2 }, { count: 2 }]);
    market.Model().countDocuments.mockResolvedValue(10);
    await runAll(market, trade());
    expect(tradeCalls()).toHaveLength(0);
  });

  it("rejects a non-integer limit and falls back to the average check", async () => {
    setLimits(market.marketType, { maxTradesPerDay: 2.5 });
    market.Model().aggregate.mockResolvedValue([{ count: 2 }, { count: 2 }, { count: 2 }]);
    market.Model().countDocuments.mockResolvedValue(3);
    await runAll(market, trade());
    expect(tradeCalls()).toHaveLength(0);
  });
});

describe.each(Object.entries(MARKETS))("rule 8 · confidence_reminder (%s)", (_name, market) => {
  it("fires on exactly the 2nd disciplined win of the day", async () => {
    market.Model().countDocuments.mockResolvedValue(2);
    await runAll(market, trade({ profit: 10, setupScore: 75 }));
    const p = sentPayload("confidence_reminder");
    expect(p.dedupeKey).toBe(`confidence:${USER}:${market.marketType}:2026-09-21`);
    expect(p.deepLink).toBe(`${market.root}/analytics`);
  });

  it.each([1, 3, 4, 5])("does not fire on win #%s", async (n) => {
    market.Model().countDocuments.mockResolvedValue(n);
    await runAll(market, trade({ profit: 10, setupScore: 75 }));
    expect(sentTypes()).not.toContain("confidence_reminder");
  });

  it("does not fire on a win with setupScore < 70 or on a loss", async () => {
    market.Model().countDocuments.mockResolvedValue(2);
    await runAll(market, trade({ profit: 10, setupScore: 69 }));
    await runAll(market, trade({ profit: -10, setupScore: 90 }));
    expect(sentTypes()).not.toContain("confidence_reminder");
  });
});

describe("present-tense alerts only for recent trades", () => {
  it("editing a trade from last month fires nothing and enqueues nothing", async () => {
    const old = trade({ stopLoss: null, profit: -50, tradeDate: new Date(NOW.getTime() - 30 * 24 * 3600e3) });
    await evaluateSmartNotifications({ userId: USER, trade: old, marketType: "Forex", collection: "forex", timezone: TZ });
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
    expect(enqueueSmartNotificationChecks).not.toHaveBeenCalled();
  });

  it("the worker skips a trade that was edited into the past", async () => {
    const old = trade({ profit: -50, tradeDate: new Date(NOW.getTime() - 3 * 24 * 3600e3) });
    await expect(runAsyncChecks({ userId: USER, trade: old, marketType: "Forex", collection: "forex", timezone: TZ }))
      .resolves.toEqual({ skipped: "old_trade" });
  });

  it("a trade from earlier today still counts", async () => {
    await evaluateSmartNotifications({ userId: USER, trade: trade({ stopLoss: null, tradeDate: new Date(NOW.getTime() - 6 * 3600e3) }), marketType: "Forex", collection: "forex", timezone: TZ });
    expect(sentTypes()).toContain("no_stop_loss");
  });

  it("uses the user's own timezone when the caller passes none", async () => {
    await evaluateSmartNotifications({ userId: USER, trade: trade(), marketType: "Forex", collection: "forex" });
    expect(enqueueSmartNotificationChecks).toHaveBeenCalledWith(expect.objectContaining({ timezone: "Europe/London" }));
  });
});

describe("money in alert copy", () => {
  it("shows the market's currency on loss amounts", () => {
    expect(formatMoney(-1523.5, "indian")).toBe("−₹1,523.50");
    expect(formatMoney(-12.3, "forex")).toBe("−$12.30");
  });
});
