// User.findById is consumed by both buildFirstInsight (needs onboarding) and
// maybeMarkComplete (needs isOnboardingCompleted). We return a chainable
// `.select().lean()` so the production code's await works as written.
function userFindByIdFactory(doc = null) {
  return jest.fn(() => ({
    select: () => ({ lean: () => Promise.resolve(doc) }),
  }));
}

jest.mock("../../models/Users", () => ({
  findById: jest.fn(() => ({
    select: () => ({ lean: () => Promise.resolve(null) }),
  })),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
}));

jest.mock("../../models/SetupStrategy", () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({
    _id: "setup-1",
    name: "Daily structure pullback",
  }),
}));

jest.mock("../../models/Trade", () => ({
  findOne: jest.fn(() => ({
    sort: () => ({ lean: () => Promise.resolve(null) }),
  })),
}));

jest.mock("../../models/IndianTrade", () => ({
  findOne: jest.fn(() => ({
    sort: () => ({ lean: () => Promise.resolve(null) }),
  })),
}));

jest.mock("../../services/authCacheService", () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const User = require("../../models/Users");
const SetupStrategy = require("../../models/SetupStrategy");
const onboardingService = require("../../services/onboardingService");

describe("onboardingService.computeFunnel", () => {
  it("returns zero progress for a fresh user", () => {
    const funnel = onboardingService.computeFunnel({});
    expect(funnel.percent).toBe(0);
    expect(funnel.completedCount).toBe(0);
    expect(funnel.totalCount).toBe(onboardingService.FLOW_STEPS.length);
    expect(funnel.isComplete).toBe(false);
    expect(funnel.nextStepKey).toBe("welcomeSeen");
  });

  it("flips isComplete when all flow steps are done", () => {
    const o = {
      welcomeSeen: true,
      marketSelected: true,
      styleSelected: true,
      setupAdded: true,
      tradeAdded: true,
      firstInsightSeen: true,
    };
    const funnel = onboardingService.computeFunnel(o);
    expect(funnel.percent).toBe(100);
    expect(funnel.isComplete).toBe(true);
    expect(funnel.nextStepKey).toBeNull();
  });

  it("treats tradeSkipped as 'trade step done' so explorer-mode users can reach the insight step", () => {
    const o = {
      welcomeSeen: true,
      marketSelected: true,
      styleSelected: true,
      setupAdded: true,
      tradeAdded: false,
      tradeSkipped: true,
    };
    const funnel = onboardingService.computeFunnel(o);
    const tradeStep = funnel.steps.find((s) => s.key === "tradeAdded");
    expect(tradeStep.completed).toBe(true);
    expect(tradeStep.skipped).toBe(true);
    expect(funnel.nextStepKey).toBe("firstInsightSeen");
  });

  it("explorer who skipped the trade but hasn't seen the insight is still not complete", () => {
    const o = {
      welcomeSeen: true,
      marketSelected: true,
      styleSelected: true,
      setupAdded: true,
      tradeSkipped: true,
    };
    expect(onboardingService.computeFunnel(o).isComplete).toBe(false);
  });

  it("weights the first-trade and first-insight steps more than welcome/market", () => {
    const earlySteps = onboardingService.computeFunnel({ welcomeSeen: true, marketSelected: true });
    const tradeStep  = onboardingService.computeFunnel({ welcomeSeen: true, marketSelected: true, styleSelected: true, setupAdded: true, tradeAdded: true });
    expect(tradeStep.percent).toBeGreaterThan(earlySteps.percent + 30);
  });

  it("identifies the next step in flow order", () => {
    const funnel = onboardingService.computeFunnel({
      welcomeSeen: true,
      marketSelected: true,
    });
    expect(funnel.nextStepKey).toBe("styleSelected");
  });
});

describe("onboardingService.isStepDone", () => {
  it("returns true for a directly-set flag", () => {
    expect(onboardingService.isStepDone("setupAdded", { setupAdded: true })).toBe(true);
  });
  it("returns true for tradeAdded when tradeSkipped is set", () => {
    expect(onboardingService.isStepDone("tradeAdded", { tradeAdded: false, tradeSkipped: true })).toBe(true);
  });
  it("returns false for unrelated steps with tradeSkipped set", () => {
    expect(onboardingService.isStepDone("firstInsightSeen", { tradeSkipped: true })).toBe(false);
  });
});

describe("onboardingService.seedDefaultSetup", () => {
  beforeEach(() => jest.clearAllMocks());

  it("seeds the style-specific default and flips setupAdded", async () => {
    await onboardingService.seedDefaultSetup({ userId: "u1", market: "Forex", styleId: "swing" });
    expect(SetupStrategy.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = SetupStrategy.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ user: "u1", marketType: "Forex", name: "Daily structure pullback" });
    expect(update.$setOnInsert.name).toBe("Daily structure pullback");
    expect(update.$setOnInsert.rules).toHaveLength(3);
    expect(options.upsert).toBe(true);

    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: "u1" },
      { $set: { "onboarding.setupAdded": true } }
    );
  });

  it("falls back to a sane default style when an unknown id is passed", async () => {
    await onboardingService.seedDefaultSetup({ userId: "u1", market: "Forex", styleId: "unknown" });
    expect(SetupStrategy.findOneAndUpdate).toHaveBeenCalled();
    const [, update] = SetupStrategy.findOneAndUpdate.mock.calls[0];
    expect(update.$setOnInsert.name).toBeTruthy();
    expect(update.$setOnInsert.rules.length).toBeGreaterThan(0);
  });

  it("accepts a custom name + rules over the seed", async () => {
    await onboardingService.seedDefaultSetup({
      userId: "u1",
      market: "Forex",
      styleId: "swing",
      custom: { name: "My breakouts", rules: ["wait", "confirm", "enter"] },
    });
    const [filter, update] = SetupStrategy.findOneAndUpdate.mock.calls[0];
    expect(filter.name).toBe("My breakouts");
    expect(update.$setOnInsert.rules).toHaveLength(3);
  });

  it("upserts so a second call with the same name does not throw (collision-safe)", async () => {
    await onboardingService.seedDefaultSetup({ userId: "u1", market: "Forex", styleId: "swing" });
    await onboardingService.seedDefaultSetup({ userId: "u1", market: "Forex", styleId: "swing" });
    expect(SetupStrategy.findOneAndUpdate).toHaveBeenCalledTimes(2);
    SetupStrategy.findOneAndUpdate.mock.calls.forEach(([, , opts]) => {
      expect(opts.upsert).toBe(true);
    });
  });
});

describe("onboardingService.markTradeSkipped", () => {
  beforeEach(() => jest.clearAllMocks());

  it("flips tradeSkipped without setting tradeAdded so analytics keep the two apart", async () => {
    await onboardingService.markTradeSkipped({ userId: "u1", reason: "no_screenshot" });
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: "u1" },
      { $set: { "onboarding.tradeSkipped": true } }
    );
    const tradeAddedCall = User.updateOne.mock.calls.find(([, update]) =>
      update?.$set && "onboarding.tradeAdded" in update.$set
    );
    expect(tradeAddedCall).toBeUndefined();
  });

  it("is idempotent — calling twice produces the same write twice without throwing", async () => {
    await onboardingService.markTradeSkipped({ userId: "u1" });
    await onboardingService.markTradeSkipped({ userId: "u1" });
    expect(User.updateOne).toHaveBeenCalledTimes(2);
  });
});

describe("onboardingService.buildFirstInsight", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the no-trade welcome variant when there's no trade and no skip", async () => {
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ onboarding: {} }) }),
    });
    const insight = await onboardingService.buildFirstInsight({
      userId: "u1",
      market: "Forex",
      tradingStyle: "swing",
    });
    expect(insight.variant).toBe("waiting");
    expect(insight.body).toMatch(/swing/i);
    expect(insight.evidence).toMatch(/0 trades/);
  });

  it("returns the explorer variant when the user explicitly skipped the trade step", async () => {
    User.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ onboarding: { tradeSkipped: true } }) }),
    });
    const insight = await onboardingService.buildFirstInsight({
      userId: "u1",
      market: "Indian_Market",
      tradingStyle: "scalper",
    });
    expect(insight.variant).toBe("explorer");
    expect(insight.body).toMatch(/scalper/i);
    expect(insight.body).toMatch(/no pressure|no trades yet|paper|watch/i);
    expect(insight.action).toBeTruthy();
    expect(insight.title).toMatch(/set up/i);
  });
});
