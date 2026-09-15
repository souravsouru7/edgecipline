"use strict";

// Free-tier nudge funnel: touchpoint selection, dispatch idempotency,
// channel outcomes, premium re-check at send time, and the cron's
// eligibility query. Mirrors subscriptionRescue.test.js.

jest.mock("../../models/RescueDispatch", () => ({
  create: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models/NotificationHistory", () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../models/Users", () => ({ find: jest.fn() }));
jest.mock("../../queues/smartNotificationQueue", () => ({
  enqueueNotificationDelivery: jest.fn().mockResolvedValue({ jobId: "j1" }),
}));
jest.mock("../../services/mailService", () => ({
  sendFreeTierEmail: jest.fn().mockResolvedValue(true),
  sendRescueEmail: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/analyticsEventService", () => ({ track: jest.fn() }));
jest.mock("../../services/freeTierFunnelService", () => {
  const actual = jest.requireActual("../../services/freeTierFunnelService");
  return { ...actual, buildFreeTierContext: jest.fn() };
});
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../utils/cronMetrics", () => ({ recordCronRun: jest.fn((name, r) => ({ name, ...r })) }));
jest.mock("../../utils/distributedLock", () => ({
  withCronLock: jest.fn(async (_opts, fn) => ({ result: await fn() })),
}));

const RescueDispatch = require("../../models/RescueDispatch");
const NotificationHistory = require("../../models/NotificationHistory");
const User = require("../../models/Users");
const { enqueueNotificationDelivery } = require("../../queues/smartNotificationQueue");
const { sendFreeTierEmail } = require("../../services/mailService");
const analytics = require("../../services/analyticsEventService");
const { buildFreeTierContext } = require("../../services/freeTierFunnelService");
const nudge = require("../../services/freeTierNudgeService");
const cron = require("../../jobs/freeTierNudgeCron");

const ONE_DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * ONE_DAY);

function makeUser(overrides = {}) {
  return {
    _id: "user-1",
    name: "Alex Trader",
    email: "alex@example.com",
    role: "user",
    subscriptionStatus: "inactive",
    totalPaid: 0,
    streaks: { journal: { current: 0 }, rule: { current: 0 } },
    freeTier: { lastFreeTradeAt: ago(1), exhaustedMarkets: ["Forex"] },
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    name: "Alex",
    recentTrades: [
      { id: "t1", market: "Forex", symbol: "EURUSD", side: "BUY", pnl: 12, date: new Date().toISOString() },
      { id: "t2", market: "Forex", symbol: "EURUSD", side: "SELL", pnl: -4, date: new Date().toISOString() },
    ],
    tradesLogged: 2,
    primaryTrade: { symbol: "EURUSD", market: "Forex" },
    primaryMarket: "Forex",
    primaryMarketLabel: "Forex",
    exhaustedMarkets: ["Forex"],
    freeTradeLimit: 2,
    disciplineStreak: 0,
    teaserInsight: { code: "same_pair", locked: true, text: "Your two EURUSD trades share a pattern — unlock to see it." },
    offer: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  RescueDispatch.create.mockResolvedValue({ _id: "d1" });
  NotificationHistory.countDocuments.mockResolvedValue(0);
});

describe("touchpoint table", () => {
  test("has exactly D+1, D+3, D+7, D+14 with the required channels", () => {
    const byCode = Object.fromEntries(nudge.TOUCHPOINTS.map((t) => [t.code, t]));
    expect(Object.keys(byCode)).toEqual(["free_d_plus_1", "free_d_plus_3", "free_d_plus_7", "free_d_plus_14"]);
    expect(byCode.free_d_plus_1.channels).toEqual({ banner: true, push: true, email: false });
    expect(byCode.free_d_plus_3.channels).toEqual({ banner: true, push: false, email: true });
    expect(byCode.free_d_plus_7.channels).toEqual({ banner: true, push: true, email: true });
    expect(byCode.free_d_plus_14.channels.banner).toBe(true);
    expect(nudge.TOUCHPOINTS.map((t) => t.daysOffset)).toEqual([1, 3, 7, 14]);
  });

  test("codes never collide with the subscription rescue funnel", () => {
    const rescue = require("../../services/subscriptionRescueService").TOUCHPOINTS_BY_CODE;
    for (const t of nudge.TOUCHPOINTS) expect(rescue[t.code]).toBeUndefined();
  });

  test("D+1 copy names the user's actual trade, never a hardcoded symbol", () => {
    const withTrade = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_1.build(makeContext({ primaryTrade: { symbol: "XAUUSD" } }));
    expect(withTrade.banner.headline).toMatch(/^Your XAUUSD trade is logged/);
    expect(withTrade.push.title).toBe("Your XAUUSD trade is logged");
    const src = require("fs").readFileSync(require.resolve("../../services/freeTierNudgeService"), "utf8");
    expect(src).not.toMatch(/EURUSD/);
  });

  test("D+1 without a live trade uses neutral copy", () => {
    const p = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_1.build(makeContext({ primaryTrade: null, recentTrades: [], tradesLogged: 0 }));
    expect(p.banner.headline).toBe("Your free trades are logged. There's a pattern worth checking 🔒");
    expect(p.push.title).toBe("Your Forex trade is logged");
  });

  test("D+3 copy is grammatical for one live trade and for none", () => {
    const one = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_3.build(makeContext({ tradesLogged: 1 }));
    expect(one.banner.headline).toBe("Alex, your trade is waiting to be read.");
    const none = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_3.build(makeContext({ tradesLogged: 0 }));
    expect(none.banner.headline).toBe("Alex, your trade log is waiting to be read.");
  });

  test("no touchpoint copy uses fake urgency, discounts, or data-loss threats", () => {
    const banned = /(\d+% off|discount|coupon|expires in|hours left|last chance|delete|lose your data|lost forever|before it's gone)/i;
    for (const t of nudge.TOUCHPOINTS) {
      for (const ctx of [makeContext(), makeContext({ recentTrades: [], tradesLogged: 0, primaryTrade: null, disciplineStreak: 9 })]) {
        const p = t.build(ctx);
        for (const channel of ["banner", "push", "email"]) {
          if (!p[channel]) continue;
          for (const v of Object.values(p[channel])) expect(String(v)).not.toMatch(banned);
        }
      }
    }
  });
});

describe("pickActiveTouchpointForUser (banner)", () => {
  test.each([
    [0.5, null],
    [1, "free_d_plus_1"],
    [2.9, "free_d_plus_1"],
    [3, "free_d_plus_3"],
    [6.9, "free_d_plus_3"],
    [7, "free_d_plus_7"],
    [13.9, "free_d_plus_7"],
    [14, "free_d_plus_14"],
    [20.9, "free_d_plus_14"],
    [21, null],
    [60, null],
  ])("%s days after T0 → %s", (days, expected) => {
    const tp = nudge.pickActiveTouchpointForUser(makeUser({ freeTier: { lastFreeTradeAt: ago(days) } }));
    expect(tp ? tp.code : null).toBe(expected);
  });

  test("no T0 → nothing", () => {
    expect(nudge.pickActiveTouchpointForUser(makeUser({ freeTier: { lastFreeTradeAt: null } }))).toBeNull();
    expect(nudge.pickActiveTouchpointForUser({})).toBeNull();
  });
});

describe("dispatchTouchpoint", () => {
  const D1 = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_1;
  const D3 = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_3;
  const D7 = nudge.TOUCHPOINTS_BY_CODE.free_d_plus_7;

  test("writes a free_tier dispatch row anchored on T0, then pushes", async () => {
    const user = makeUser();
    const res = await nudge.dispatchTouchpoint({ user, touchpoint: D1, context: makeContext() });
    expect(res).toMatchObject({ dispatched: true, outcome: { push: "sent", email: null } });

    const row = RescueDispatch.create.mock.calls[0][0];
    expect(row).toMatchObject({
      user: "user-1",
      funnel: "free_tier",
      phase: "free_tier",
      touchpoint: "free_d_plus_1",
      cycleExpiry: user.freeTier.lastFreeTradeAt,
    });

    const { notification } = enqueueNotificationDelivery.mock.calls[0][0];
    expect(notification.type).toBe("free_tier_d_plus_1");
    expect(notification.dedupeKey).toBe(`free_tier:free_d_plus_1:user-1:${user.freeTier.lastFreeTradeAt.toISOString()}`);
    expect(notification.title).toBe("Your EURUSD trade is logged");

    expect(analytics.track).toHaveBeenCalledWith("free_nudge_sent", expect.objectContaining({
      source: "cron",
      properties: expect.objectContaining({ touchpoint: "free_d_plus_1", market: "Forex", pushOutcome: "sent" }),
    }));
  });

  test("a duplicate-key insert is a silent no-op (cron rerun / second instance)", async () => {
    RescueDispatch.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = await nudge.dispatchTouchpoint({ user: makeUser(), touchpoint: D1, context: makeContext() });
    expect(res).toEqual({ ok: true, alreadyDispatched: true });
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
    expect(sendFreeTierEmail).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  test.each([
    ["upgraded to a paid plan", { subscriptionStatus: "active", subscriptionExpiry: new Date(Date.now() + 30 * ONE_DAY) }],
    ["bought on Google Play", { playEntitlementExpiry: new Date(Date.now() + 30 * ONE_DAY) }],
    ["is a lapsed subscriber", { subscriptionStatus: "expired", subscriptionExpiry: ago(40) }],
    ["is an admin", { role: "admin" }],
  ])("re-checks at send time: a user who %s is skipped and nothing is written", async (_l, over) => {
    const res = await nudge.dispatchTouchpoint({ user: makeUser(over), touchpoint: D1, context: makeContext() });
    expect(res).toMatchObject({ skipped: true, reason: "ineligible" });
    expect(RescueDispatch.create).not.toHaveBeenCalled();
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  test("D+3 sends email and no push", async () => {
    const res = await nudge.dispatchTouchpoint({ user: makeUser(), touchpoint: D3, context: makeContext() });
    expect(res.outcome).toEqual({ push: null, email: "sent" });
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
    expect(sendFreeTierEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "alex@example.com",
      touchpoint: "free_d_plus_3",
      subject: "Alex, here's what your trades are telling you",
    }));
  });

  test("email is skipped (not failed) when the account has no usable address", async () => {
    const res = await nudge.dispatchTouchpoint({ user: makeUser({ email: "" }), touchpoint: D3, context: makeContext() });
    expect(res.outcome.email).toBe("skipped");
    expect(sendFreeTierEmail).not.toHaveBeenCalled();
    expect(RescueDispatch.findByIdAndUpdate).toHaveBeenCalledWith("d1", { outcome: { push: null, email: "skipped" } });
  });

  test("an email provider failure is recorded, not thrown", async () => {
    sendFreeTierEmail.mockRejectedValue(new Error("smtp down"));
    const res = await nudge.dispatchTouchpoint({ user: makeUser(), touchpoint: D7, context: makeContext() });
    expect(res.outcome).toEqual({ push: "sent", email: "failed" });
  });

  test("push is skipped when the account already hit the daily push ceiling", async () => {
    NotificationHistory.countDocuments.mockResolvedValue(nudge.DAILY_PUSH_CEILING);
    const res = await nudge.dispatchTouchpoint({ user: makeUser(), touchpoint: D1, context: makeContext() });
    expect(res.outcome.push).toBe("skipped");
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  test("push goes through the smart notification queue, never direct", () => {
    const src = require("fs").readFileSync(require.resolve("../../services/freeTierNudgeService"), "utf8");
    expect(src).toMatch(/enqueueNotificationDelivery/);
    expect(src).not.toMatch(/notificationService|sendPushToUser|notifyUser/);
  });

  test("dryRun renders the payload without writing", async () => {
    const res = await nudge.dispatchTouchpoint({ user: makeUser(), touchpoint: D7, context: makeContext(), dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.payload.email.subject).toBe("What Premium adds to your trade log");
    expect(RescueDispatch.create).not.toHaveBeenCalled();
  });
});

describe("freeTierNudgeCron", () => {
  function userQuery(rows) {
    const chain = { select: jest.fn(), limit: jest.fn(), lean: jest.fn().mockResolvedValue(rows) };
    chain.select.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    User.find.mockReturnValue(chain);
    return chain;
  }

  test("queries only never-paid, non-admin, live accounts inside the touchpoint window", async () => {
    userQuery([]);
    const now = new Date("2026-09-14T12:00:00Z");
    await cron.processTouchpoint(nudge.TOUCHPOINTS_BY_CODE.free_d_plus_3, now, 200);
    const [filter] = User.find.mock.calls[0];
    expect(filter).toMatchObject({
      role: { $ne: "admin" },
      accountStatus: { $ne: "disabled" },
      pendingDeletion: { $ne: true },
      subscriptionStatus: "inactive",
      subscriptionExpiry: null,
      playEntitlementExpiry: null,
      totalPaid: { $not: { $gt: 0 } },
    });
    const { $gte, $lte } = filter["freeTier.lastFreeTradeAt"];
    expect($gte.getTime()).toBe(now.getTime() - 3 * ONE_DAY - 12 * 3600 * 1000);
    expect($lte.getTime()).toBe(now.getTime() - 3 * ONE_DAY + 12 * 3600 * 1000);
  });

  test("dispatches eligible users, skips upgraded ones, counts duplicates as skipped", async () => {
    userQuery([
      makeUser({ _id: "u-free" }),
      makeUser({ _id: "u-paid", subscriptionStatus: "active", subscriptionExpiry: new Date(Date.now() + ONE_DAY) }),
      makeUser({ _id: "u-dup" }),
    ]);
    buildFreeTierContext.mockResolvedValue(makeContext());
    RescueDispatch.create
      .mockResolvedValueOnce({ _id: "d-free" })
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: 11000 }));

    const res = await cron.processTouchpoint(nudge.TOUCHPOINTS_BY_CODE.free_d_plus_1, new Date(), 200);

    expect(res).toEqual({ matched: 3, dispatched: 1, skipped: 2, failed: 0 });
    expect(buildFreeTierContext).toHaveBeenCalledTimes(2); // not for the paid user
    expect(enqueueNotificationDelivery).toHaveBeenCalledTimes(1);
  });

  test("a per-user failure is isolated", async () => {
    userQuery([makeUser({ _id: "u-bad" }), makeUser({ _id: "u-good" })]);
    buildFreeTierContext
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeContext());
    const res = await cron.processTouchpoint(nudge.TOUCHPOINTS_BY_CODE.free_d_plus_1, new Date(), 200);
    expect(res).toEqual({ matched: 2, dispatched: 1, skipped: 0, failed: 1 });
  });

  test("the full job walks every touchpoint under the lock and records the run", async () => {
    userQuery([]);
    const result = await cron.runFreeTierNudgeJob(new Date());
    expect(User.find).toHaveBeenCalledTimes(nudge.TOUCHPOINTS.length);
    expect(result).toMatchObject({ name: "freeTierNudgeCron", totalItems: 0, success: 0, failure: 0 });
  });
});
