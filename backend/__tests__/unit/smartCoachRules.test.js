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
const { enqueueSmartNotificationChecks } = require("../../queues/smartNotificationQueue");
const { evaluateSmartNotifications, runAsyncChecks } = require("../../services/smartNotificationEvaluator");

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

async function runAll(market, t) {
  const payload = { userId: USER, trade: t, marketType: market.marketType, collection: market.collection, timezone: TZ };
  await evaluateSmartNotifications(payload);          // sync checks + enqueue
  await runAsyncChecks(payload);                      // what the worker runs
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const M of [Trade, IndianTrade]) {
    M.countDocuments.mockResolvedValue(0);
    M.find.mockImplementation(() => chainable([]));
    M.aggregate.mockResolvedValue([]);
  }
});

describe("evaluateSmartNotifications split", () => {
  it("runs the 3 fast checks inline and hands the 5 heavy checks to the queue", async () => {
    await evaluateSmartNotifications({ userId: USER, trade: trade({ stopLoss: null }), marketType: "Forex", collection: "forex" });
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
    expect(p.body).toContain("-30.00");
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

describe.each(Object.entries(MARKETS))("rule 7 · daily_loss_warning (%s)", (_name, market) => {
  const day = (profits) => market.Model().find.mockImplementation(() => chainable(profits.map((profit) => ({ profit }))));

  it("fires when today's net ≤ 2× the average loss", async () => {
    day([-10, -10, 5]); // avg loss -10, threshold -20, net -15 → no; use a worse day
    day([-10, -10, -5]); // avg loss -8.33, threshold -16.67, net -25 → fire
    await runAll(market, trade({ profit: -5 }));
    const p = sentPayload("daily_loss_warning");
    expect(p.dedupeKey).toBe(`daily-loss:${USER}:${market.marketType}:2026-09-21`);
    expect(p.deepLink).toBe(`${market.root}/trades?filter=today`);
  });

  it("fires at exactly the threshold", async () => {
    day([-10, -10]); // avg -10, threshold -20, net -20 → totalLoss > threshold is false → fire
    await runAll(market, trade({ profit: -10 }));
    expect(sentTypes()).toContain("daily_loss_warning");
  });

  it("does not fire just above the threshold", async () => {
    day([-10, -10, 1]); // net -19 > -20
    await runAll(market, trade({ profit: 1 }));
    expect(sentTypes()).not.toContain("daily_loss_warning");
  });

  it("does not fire with a single trade", async () => {
    day([-50]);
    await runAll(market, trade({ profit: -50 }));
    expect(sentTypes()).not.toContain("daily_loss_warning");
  });

  it("does not fire with fewer than two losers", async () => {
    day([-50, 10]);
    await runAll(market, trade({ profit: -50 }));
    expect(sentTypes()).not.toContain("daily_loss_warning");
  });

  it("does not fire on two winning trades or a winning current trade", async () => {
    day([10, 10]);
    await runAll(market, trade({ profit: 10 }));
    expect(sentTypes()).not.toContain("daily_loss_warning");
  });

  it("does not read the other market's trades", async () => {
    const other = market === MARKETS.forex ? IndianTrade : Trade;
    other.find.mockImplementation(() => chainable([{ profit: -100 }, { profit: -100 }]));
    await runAll(market, trade({ profit: -1 }));
    expect(sentTypes()).not.toContain("daily_loss_warning");
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
