// Touchpoint selection logic + dispatch idempotency for the Subscription
// Rescue Funnel. The unique index on RescueDispatch is the production safety
// net; these tests cover the in-process selection logic that drives the
// cron + banner.

jest.mock("../../models/RescueDispatch", () => {
  const create = jest.fn();
  const findByIdAndUpdate = jest.fn().mockResolvedValue({});
  return { create, findByIdAndUpdate };
});

jest.mock("../../queues/smartNotificationQueue", () => ({
  enqueueNotificationDelivery: jest.fn().mockResolvedValue({ jobId: "j1" }),
}));

jest.mock("../../services/mailService", () => ({
  sendRescueEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../services/analyticsEventService", () => ({
  track: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const RescueDispatch = require("../../models/RescueDispatch");
const { enqueueNotificationDelivery } = require("../../queues/smartNotificationQueue");
const { sendRescueEmail } = require("../../services/mailService");
const analytics = require("../../services/analyticsEventService");
const {
  TOUCHPOINTS,
  TOUCHPOINTS_BY_CODE,
  windowForTouchpoint,
  pickActiveTouchpointForUser,
  dispatchTouchpoint,
} = require("../../services/subscriptionRescueService");

const ONE_DAY = 24 * 60 * 60 * 1000;
const future = (ms) => new Date(Date.now() + ms);
const past   = (ms) => new Date(Date.now() - ms);

function makeUser(overrides = {}) {
  return {
    _id: "user-1",
    name: "Alex Trader",
    email: "alex@example.com",
    streaks: { journal: { current: 0, longest: 0 }, rule: { current: 0 } },
    subscriptionStatus: "active",
    subscriptionExpiry: future(2 * ONE_DAY),
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  return {
    name: "Alex",
    disciplineStreak: 12,
    journalStreak: 12,
    ruleStreak: 8,
    longestStreak: 21,
    tradesLogged: 47,
    bestSetup: { name: "ORB", trades: 18, winRate: 67 },
    weeklyReportsCount: 4,
    latestInsightLine: "You enter cleanly on green days; on red days you skip the plan.",
    subscriptionExpiry: future(2 * ONE_DAY),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("windowForTouchpoint", () => {
  it("D-7 window is centered 7 days in the future ±12h", () => {
    const now = Date.UTC(2026, 5, 1, 0, 0, 0); // 2026-06-01T00:00:00Z
    const w = windowForTouchpoint({ daysOffset: -7 }, now);
    expect(w.from.getTime()).toBe(now + 7 * ONE_DAY - 12 * 60 * 60 * 1000);
    expect(w.to.getTime()).toBe(now + 7 * ONE_DAY + 12 * 60 * 60 * 1000);
  });

  it("D+0 window straddles `now` symmetrically", () => {
    const now = Date.UTC(2026, 5, 1, 0, 0, 0);
    const w = windowForTouchpoint({ daysOffset: 0 }, now);
    expect(w.to.getTime() - w.from.getTime()).toBe(24 * 60 * 60 * 1000);
    expect((w.from.getTime() + w.to.getTime()) / 2).toBe(now);
  });
});

describe("pickActiveTouchpointForUser — pre-expiry", () => {
  it("returns null if subscription is healthy (>7d out)", () => {
    expect(pickActiveTouchpointForUser(makeUser({ subscriptionExpiry: future(30 * ONE_DAY) }))).toBeNull();
  });

  it("returns D-7 in the 4–7 day window", () => {
    expect(pickActiveTouchpointForUser(makeUser({ subscriptionExpiry: future(6 * ONE_DAY) }))?.code).toBe("d_minus_7");
    expect(pickActiveTouchpointForUser(makeUser({ subscriptionExpiry: future(7 * ONE_DAY) }))?.code).toBe("d_minus_7");
  });

  it("returns D-3 in the 2–3 day window", () => {
    expect(pickActiveTouchpointForUser(makeUser({ subscriptionExpiry: future(3 * ONE_DAY) }))?.code).toBe("d_minus_3");
    expect(pickActiveTouchpointForUser(makeUser({ subscriptionExpiry: future(2 * ONE_DAY) }))?.code).toBe("d_minus_3");
  });

  it("returns D-1 with less than 24h left", () => {
    expect(pickActiveTouchpointForUser(makeUser({ subscriptionExpiry: future(6 * 60 * 60 * 1000) }))?.code).toBe("d_minus_1");
  });
});

describe("pickActiveTouchpointForUser — post-expiry", () => {
  it("returns D+0 within 3 days after expiry", () => {
    expect(pickActiveTouchpointForUser(makeUser({
      subscriptionStatus: "expired",
      subscriptionExpiry: past(2 * ONE_DAY),
    }))?.code).toBe("d_plus_0");
  });

  it("returns D+3 from day 3 to 6", () => {
    expect(pickActiveTouchpointForUser(makeUser({
      subscriptionStatus: "expired",
      subscriptionExpiry: past(5 * ONE_DAY),
    }))?.code).toBe("d_plus_3");
  });

  it("returns D+7 from day 7 to 13", () => {
    expect(pickActiveTouchpointForUser(makeUser({
      subscriptionStatus: "expired",
      subscriptionExpiry: past(10 * ONE_DAY),
    }))?.code).toBe("d_plus_7");
  });

  it("returns D+14 from day 14 onward", () => {
    expect(pickActiveTouchpointForUser(makeUser({
      subscriptionStatus: "expired",
      subscriptionExpiry: past(30 * ONE_DAY),
    }))?.code).toBe("d_plus_14");
  });
});

describe("dispatchTouchpoint", () => {
  it("inserts a RescueDispatch and fans out on the configured channels", async () => {
    RescueDispatch.create.mockResolvedValueOnce({ _id: "dispatch-1" });
    const user = makeUser({ subscriptionExpiry: future(3 * ONE_DAY) });
    const tp = TOUCHPOINTS_BY_CODE.d_minus_3;
    const context = makeContext();

    const result = await dispatchTouchpoint({ user, touchpoint: tp, context });

    expect(result.dispatched).toBe(true);
    expect(RescueDispatch.create).toHaveBeenCalledWith(expect.objectContaining({
      user: user._id,
      cycleExpiry: user.subscriptionExpiry,
      touchpoint: "d_minus_3",
      phase: "pre_expiry",
    }));
    expect(enqueueNotificationDelivery).toHaveBeenCalledTimes(1);
    expect(sendRescueEmail).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith("rescue_dispatched", expect.objectContaining({
      userId: user._id,
      source: "cron",
    }));
  });

  it("is a silent no-op when the unique index rejects a duplicate", async () => {
    const dupErr = Object.assign(new Error("E11000"), { code: 11000 });
    RescueDispatch.create.mockRejectedValueOnce(dupErr);

    const result = await dispatchTouchpoint({
      user: makeUser(),
      touchpoint: TOUCHPOINTS_BY_CODE.d_minus_3,
      context: makeContext(),
    });

    expect(result.alreadyDispatched).toBe(true);
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
    expect(sendRescueEmail).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("skips email when the touchpoint's channel matrix says so (D-7)", async () => {
    RescueDispatch.create.mockResolvedValueOnce({ _id: "dispatch-2" });
    await dispatchTouchpoint({
      user: makeUser({ subscriptionExpiry: future(7 * ONE_DAY) }),
      touchpoint: TOUCHPOINTS_BY_CODE.d_minus_7,
      context: makeContext(),
    });
    expect(sendRescueEmail).not.toHaveBeenCalled();
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled(); // D-7 is banner-only
  });

  it("skips push when the touchpoint's channel matrix says so (D+14)", async () => {
    RescueDispatch.create.mockResolvedValueOnce({ _id: "dispatch-3" });
    await dispatchTouchpoint({
      user: makeUser({ subscriptionStatus: "expired", subscriptionExpiry: past(14 * ONE_DAY) }),
      touchpoint: TOUCHPOINTS_BY_CODE.d_plus_14,
      context: makeContext(),
    });
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
    expect(sendRescueEmail).toHaveBeenCalledTimes(1);
  });

  it("freezes contextSnapshot on the dispatch row for later attribution", async () => {
    RescueDispatch.create.mockResolvedValueOnce({ _id: "dispatch-4" });
    const context = makeContext({ disciplineStreak: 48 });
    await dispatchTouchpoint({
      user: makeUser({ subscriptionExpiry: future(3 * ONE_DAY) }),
      touchpoint: TOUCHPOINTS_BY_CODE.d_minus_3,
      context,
    });
    expect(RescueDispatch.create).toHaveBeenCalledWith(expect.objectContaining({
      contextSnapshot: expect.objectContaining({ disciplineStreak: 48 }),
    }));
  });
});

describe("touchpoint copy uses real numbers from context", () => {
  it("D-3 banner mentions the discipline streak when streak >= 3", () => {
    const ctx = makeContext({ disciplineStreak: 12 });
    const payload = TOUCHPOINTS_BY_CODE.d_minus_3.build(ctx);
    expect(payload.banner.headline).toContain("12-day");
  });

  it("D-3 banner falls back to reports when streak is short", () => {
    const ctx = makeContext({ disciplineStreak: 1, weeklyReportsCount: 4 });
    const payload = TOUCHPOINTS_BY_CODE.d_minus_3.build(ctx);
    expect(payload.banner.headline).toMatch(/4 weekly reports/);
  });

  it("D-1 push name-drops the user's best setup when present", () => {
    const ctx = makeContext({ bestSetup: { name: "ORB", winRate: 67 } });
    const payload = TOUCHPOINTS_BY_CODE.d_minus_1.build(ctx);
    expect(payload.banner.body).toContain("ORB");
    expect(payload.banner.body).toContain("67");
  });

  it("D+0 push uses the user's latest insight when available", () => {
    const ctx = makeContext({ latestInsightLine: "You overtrade after a green Monday." });
    const payload = TOUCHPOINTS_BY_CODE.d_plus_0.build(ctx);
    expect(payload.push.body).toContain("You overtrade");
  });
});
