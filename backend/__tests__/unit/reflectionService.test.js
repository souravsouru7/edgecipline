jest.mock("../../models/DailyReflection", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../models/Trade", () => ({
  find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
}));

jest.mock("../../models/IndianTrade", () => ({
  find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
}));

jest.mock("../../services/streak.service", () => ({
  dayKeyInTz: (date = new Date()) => {
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().slice(0, 10);
  },
  addDays: (dayKey, delta) => {
    const [y, m, d] = dayKey.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
  },
  getStreakSnapshot: jest.fn().mockResolvedValue({
    todayKey: "2026-06-28",
    timezone: "Asia/Kolkata",
  }),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const reflectionService = require("../../services/reflectionService");

describe("reflectionService.computeWeeklyScore", () => {
  it("returns a zeroed shape for an empty week", () => {
    const result = reflectionService.computeWeeklyScore([]);
    expect(result.score).toBe(0);
    expect(result.completionRate).toBe(0);
    expect(result.submittedDays).toBe(0);
    expect(result.skippedDays).toBe(0);
    expect(result.window).toBe(reflectionService.WEEKLY_WINDOW_DAYS);
  });

  it("awards a perfect score for 7 disciplined, would-repeat days at peak mood", () => {
    const reflections = Array.from({ length: 7 }, () => ({
      followedPlan: "yes",
      wouldRepeat: "yes",
      mood: 5,
      confidence: 5,
      skipped: false,
    }));
    const result = reflectionService.computeWeeklyScore(reflections);
    expect(result.score).toBe(100);
    expect(result.completionRate).toBe(100);
    expect(result.submittedDays).toBe(7);
  });

  it("treats skipped days as no-data but still counts toward completion penalty", () => {
    const reflections = [
      { followedPlan: "yes", wouldRepeat: "yes", mood: 5, confidence: 5, skipped: false },
      { skipped: true },
      { skipped: true },
    ];
    const result = reflectionService.computeWeeklyScore(reflections);
    // 1/7 completion → 20*(1/7) ≈ 2.86 from completion bucket; plan+repeat+mood/conf max out 80
    expect(result.skippedDays).toBe(2);
    expect(result.submittedDays).toBe(1);
    expect(result.score).toBeGreaterThan(80);
    expect(result.score).toBeLessThanOrEqual(85);
  });

  it("rewards no-trade-day discipline over plan violations", () => {
    const violated = reflectionService.computeWeeklyScore([
      { followedPlan: "no", wouldRepeat: "no", mood: 2, confidence: 2, skipped: false },
    ]);
    const quiet = reflectionService.computeWeeklyScore([
      { followedPlan: "no_trades", wouldRepeat: "yes", mood: 4, confidence: 4, skipped: false },
    ]);
    expect(quiet.score).toBeGreaterThan(violated.score);
  });
});

describe("reflectionService.upsertReflection", () => {
  const DailyReflection = require("../../models/DailyReflection");
  const streak = require("../../services/streak.service");

  beforeEach(() => {
    jest.clearAllMocks();
    streak.getStreakSnapshot.mockResolvedValue({
      todayKey: "2026-06-28",
      timezone: "Asia/Kolkata",
    });
    DailyReflection.findOneAndUpdate.mockResolvedValue({
      _id: "r-1",
      day: "2026-06-28",
      followedPlan: "yes",
      context: { tradeCount: 0, hadTrades: false },
    });
  });

  it("backfills followedPlan='no_trades' when the user did not trade and did not answer", async () => {
    const result = await reflectionService.upsertReflection({
      userId: "user-1",
      payload: { mood: 4 },
    });

    expect(result.reflection).toBeDefined();
    const updateCall = DailyReflection.findOneAndUpdate.mock.calls[0];
    expect(updateCall[0]).toEqual({ user: "user-1", day: "2026-06-28" });
    expect(updateCall[1].$set.followedPlan).toBe("no_trades");
    expect(updateCall[1].$set.mood).toBe(4);
    expect(updateCall[1].$set.skipped).toBe(false);
  });

  it("rejects an empty payload", async () => {
    await expect(
      reflectionService.upsertReflection({ userId: "user-1", payload: {} })
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "VALIDATION_ERROR" });
  });
});

describe("reflectionService.skipReflection", () => {
  const DailyReflection = require("../../models/DailyReflection");

  beforeEach(() => {
    jest.clearAllMocks();
    DailyReflection.findOneAndUpdate.mockResolvedValue({
      _id: "r-2",
      day: "2026-06-28",
      skipped: true,
    });
  });

  it("marks today as skipped with the requested source", async () => {
    const result = await reflectionService.skipReflection({
      userId: "user-2",
      payload: { source: "notification" },
    });
    expect(result.reflection.skipped).toBe(true);
    const updateCall = DailyReflection.findOneAndUpdate.mock.calls[0];
    expect(updateCall[1].$set.skipped).toBe(true);
    expect(updateCall[1].$set.source).toBe("notification");
  });
});
