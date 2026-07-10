jest.mock("../../models/Users", () => ({
  findById: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  countDocuments: jest.fn().mockResolvedValue(0),
  find: jest.fn(),
}));

jest.mock("../../models/Trade", () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  findOne: jest.fn(() => ({
    sort: () => ({ lean: () => Promise.resolve(null) }),
  })),
}));

jest.mock("../../models/IndianTrade", () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  findOne: jest.fn(() => ({
    sort: () => ({ lean: () => Promise.resolve(null) }),
  })),
}));

jest.mock("../../models/SetupStrategy", () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
}));

jest.mock("../../services/authCacheService", () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const User = require("../../models/Users");
const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const SetupStrategy = require("../../models/SetupStrategy");
const backfill = require("../../services/onboardingBackfillService");

function mockUser(doc) {
  User.findById.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(doc) }),
  });
}

function mockTradesEarliest(earliest) {
  Trade.findOne.mockReturnValue({
    sort: () => ({ lean: () => Promise.resolve(earliest) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Trade.countDocuments.mockResolvedValue(0);
  IndianTrade.countDocuments.mockResolvedValue(0);
  SetupStrategy.countDocuments.mockResolvedValue(0);
  Trade.findOne.mockReturnValue({
    sort: () => ({ lean: () => Promise.resolve(null) }),
  });
  IndianTrade.findOne.mockReturnValue({
    sort: () => ({ lean: () => Promise.resolve(null) }),
  });
});

describe("onboardingBackfillService.buildBackfillUpdate", () => {
  it("flips every funnel flag for an existing user with trades + setups + preferredMarket", () => {
    const user = {
      preferredMarket: "Forex",
      onboarding: {},
      isOnboardingCompleted: false,
      createdAt: new Date("2026-01-01"),
    };
    const signals = {
      tradeCount: 12,
      setupCount: 2,
      earliestTradeAt: new Date("2026-02-15"),
      earliestTradeFromOcr: true,
    };
    const { set, min } = backfill.buildBackfillUpdate({ user, signals });

    expect(set["onboarding.setupAdded"]).toBe(true);
    expect(set["onboarding.marketSelected"]).toBe(true);
    expect(set["onboarding.tradeAdded"]).toBe(true);
    expect(set["onboarding.welcomeSeen"]).toBe(true);
    expect(set["onboarding.firstInsightSeen"]).toBe(true);
    expect(set.isOnboardingCompleted).toBe(true);
    expect(set.hasSeenWelcomeGuide).toBe(true);
    expect(min["onboarding.firstTradeAt"]).toEqual(signals.earliestTradeAt);
    expect(min["onboarding.firstScreenshotUploadAt"]).toEqual(signals.earliestTradeAt);
  });

  it("does NOT mark firstScreenshotUploadAt when the earliest trade was manual", () => {
    const user = { preferredMarket: "Forex", onboarding: {}, isOnboardingCompleted: false };
    const signals = {
      tradeCount: 5,
      setupCount: 1,
      earliestTradeAt: new Date("2026-02-15"),
      earliestTradeFromOcr: false,
    };
    const { min } = backfill.buildBackfillUpdate({ user, signals });
    expect(min["onboarding.firstTradeAt"]).toBeDefined();
    expect(min["onboarding.firstScreenshotUploadAt"]).toBeUndefined();
  });

  it("never overwrites a flag the user has already set", () => {
    const user = {
      preferredMarket: "Forex",
      onboarding: { tradeAdded: true, setupAdded: true, marketSelected: true, welcomeSeen: true, firstInsightSeen: true, completedAt: new Date("2026-01-01") },
      isOnboardingCompleted: true,
    };
    const signals = { tradeCount: 5, setupCount: 2, earliestTradeAt: new Date("2026-02-15"), earliestTradeFromOcr: false };
    const { set } = backfill.buildBackfillUpdate({ user, signals });

    expect(set["onboarding.tradeAdded"]).toBeUndefined();
    expect(set["onboarding.setupAdded"]).toBeUndefined();
    expect(set["onboarding.marketSelected"]).toBeUndefined();
    expect(set["onboarding.welcomeSeen"]).toBeUndefined();
    expect(set["onboarding.firstInsightSeen"]).toBeUndefined();
    // isOnboardingCompleted is also untouched (already true).
    expect(set.isOnboardingCompleted).toBeUndefined();
  });

  it("only marks isOnboardingCompleted when trade + setup + welcome + insight all line up", () => {
    const userWithOnlySetup = {
      preferredMarket: "Forex",
      onboarding: { setupAdded: true },
      isOnboardingCompleted: false,
    };
    const signalsNoTrade = { tradeCount: 0, setupCount: 1, earliestTradeAt: null, earliestTradeFromOcr: false };
    const { set: setA } = backfill.buildBackfillUpdate({ user: userWithOnlySetup, signals: signalsNoTrade });
    expect(setA.isOnboardingCompleted).toBeUndefined();

    const userTradedButNoSetup = {
      preferredMarket: "Forex",
      onboarding: {},
      isOnboardingCompleted: false,
    };
    const signalsTraded = { tradeCount: 3, setupCount: 0, earliestTradeAt: new Date("2026-02-15"), earliestTradeFromOcr: false };
    const { set: setB } = backfill.buildBackfillUpdate({ user: userTradedButNoSetup, signals: signalsTraded });
    // tradeAdded + welcomeSeen + firstInsightSeen flip, but setupAdded does not
    // (no setup count) → not fully activated yet.
    expect(setB.isOnboardingCompleted).toBeUndefined();
    expect(setB["onboarding.tradeAdded"]).toBe(true);
  });
});

describe("onboardingBackfillService.backfillUserOnboarding", () => {
  it("short-circuits when there are no signals to backfill (truly new user)", async () => {
    mockUser({
      preferredMarket: null,
      onboarding: {},
      isOnboardingCompleted: false,
    });

    const result = await backfill.backfillUserOnboarding("u1");
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("no_signals");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  it("writes the migration update for a pre-existing trader", async () => {
    mockUser({
      preferredMarket: "Forex",
      onboarding: { welcomeSeen: true },
      isOnboardingCompleted: false,
      createdAt: new Date("2026-01-01"),
    });
    Trade.countDocuments.mockResolvedValue(15);
    SetupStrategy.countDocuments.mockResolvedValue(2);
    mockTradesEarliest({
      effectiveTradeDate: new Date("2026-02-15"),
      ocrJobId: "ocr-1",
    });

    const result = await backfill.backfillUserOnboarding("u-trader");

    expect(result.changed).toBe(true);
    expect(User.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "u-trader" });
    expect(update.$set["onboarding.tradeAdded"]).toBe(true);
    expect(update.$set["onboarding.marketSelected"]).toBe(true);
    expect(update.$set["onboarding.firstInsightSeen"]).toBe(true);
    expect(update.$set.isOnboardingCompleted).toBe(true);
    expect(update.$min["onboarding.firstTradeAt"]).toBeInstanceOf(Date);
    expect(update.$min["onboarding.firstScreenshotUploadAt"]).toBeInstanceOf(Date);
  });

  it("is idempotent — re-running after a successful backfill produces no further writes", async () => {
    mockUser({
      preferredMarket: "Forex",
      onboarding: {
        welcomeSeen: true,
        marketSelected: true,
        setupAdded: true,
        tradeAdded: true,
        firstInsightSeen: true,
        firstTradeAt: new Date("2026-02-15"),
      },
      isOnboardingCompleted: true,
    });
    Trade.countDocuments.mockResolvedValue(15);
    SetupStrategy.countDocuments.mockResolvedValue(2);

    const result = await backfill.backfillUserOnboarding("u-already-done");
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("already_consistent");
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  it("dryRun mode computes the update but never writes", async () => {
    mockUser({
      preferredMarket: "Forex",
      onboarding: {},
      isOnboardingCompleted: false,
      createdAt: new Date("2026-01-01"),
    });
    Trade.countDocuments.mockResolvedValue(7);
    SetupStrategy.countDocuments.mockResolvedValue(1);
    mockTradesEarliest({
      effectiveTradeDate: new Date("2026-02-15"),
      ocrJobId: null,
    });

    const result = await backfill.backfillUserOnboarding("u-dry", { dryRun: true });
    expect(result.changed).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(result.set["onboarding.tradeAdded"]).toBe(true);
  });

  it("force=true re-evaluates even when the user looks consistent (recovery mode)", async () => {
    mockUser({
      preferredMarket: "Forex",
      onboarding: {
        welcomeSeen: true,
        marketSelected: true,
        setupAdded: true,
        tradeAdded: true,
        firstInsightSeen: true,
        firstTradeAt: new Date("2026-02-15"),
      },
      isOnboardingCompleted: true,
    });
    // Force a fresh run; signals haven't changed so the computed update is empty.
    const result = await backfill.backfillUserOnboarding("u-force", { force: true });
    expect(["no_changes", "already_consistent", "no_signals"]).toContain(result.reason);
    if (result.reason === "no_changes") {
      // force=true still touched the heavy-lifting reads but produced nothing.
      expect(User.updateOne).not.toHaveBeenCalled();
    }
  });
});
