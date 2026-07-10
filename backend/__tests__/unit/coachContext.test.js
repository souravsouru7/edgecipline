jest.mock("../../config/redis", () => ({
  client: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  isRedisReady: jest.fn(() => false),
}));

jest.mock("../../models/Trade", () => {
  const exec = (docs) => ({
    sort: () => ({
      limit: () => ({ lean: () => Promise.resolve(docs) }),
    }),
  });
  return { find: jest.fn(() => exec([])) };
});

jest.mock("../../models/IndianTrade", () => {
  const exec = (docs) => ({
    sort: () => ({
      limit: () => ({ lean: () => Promise.resolve(docs) }),
    }),
  });
  return { find: jest.fn(() => exec([])) };
});

jest.mock("../../services/streak.service", () => ({
  getStreakSnapshot: jest.fn().mockResolvedValue({
    journal:   { current: 5, longest: 9, atRisk: false },
    checklist: { current: 3, longest: 7 },
    rule:      { current: 0, longest: 4, threshold: 70 },
    todayKey:  "2026-06-28",
    timezone:  "Asia/Kolkata",
  }),
}));

jest.mock("../../services/reflectionService", () => ({
  getRecentReflections: jest.fn().mockResolvedValue({
    items: [
      {
        day: "2026-06-27",
        followedPlan: "yes",
        mood: 4,
        confidence: 4,
        wouldRepeat: "yes",
        improvement: "wait for confirmation",
        skipped: false,
        context: { tradeCount: 2, grossPnL: 35.5 },
      },
    ],
  }),
}));

jest.mock("../../services/analyticsSnapshotService", () => ({
  getSnapshot: jest.fn().mockResolvedValue({
    performance: { totalTrades: 18, wins: 9, losses: 9, winRate: 50, netPnL: -42.1, avgSetupScore: 64 },
    psychology: {
      psychologyScore: 62,
      scoreBreakdown: { planAdherencePct: 70, calmTradingPct: 60, noRevengePct: 80 },
      topEmotionalTags: [{ tag: "fomo", count: 4 }],
    },
    tradingDNA: {
      sessionDNA: { best: { name: "London" } },
      emotionDNA: { mostExpensive: { name: "fomo" }, mostProfitable: { name: "calm" } },
    },
    psychologyCost: {
      psychologyCostScore: 58,
      topLeaks: [{ name: "FOMO entries", cost: -120 }],
    },
  }),
}));

jest.mock("../../repositories/weeklyReport.repository", () => ({
  findWeeklyReportsByUser: jest.fn().mockResolvedValue([{
    weekStart: new Date("2026-06-22"),
    weekEnd: new Date("2026-06-28"),
    aiFeedback: {
      summary: "Choppy week. FOMO drove the worst losses.",
      mistakes: [{ title: "FOMO entries", evidence: "4 losses tagged fomo" }],
      improvements: [{ title: "Stop after 2 losses" }],
      nextWeekChecklist: ["Trade only A+ setups"],
      psychologyFeedback: "Calm trading rate dropped",
      dataQualityScore: 72,
    },
  }]),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const coachContextService = require("../../services/coachContextService");

describe("coachContextService.buildContext", () => {
  it("assembles all the user data streams the coach needs", async () => {
    const ctx = await coachContextService.buildContext({ userId: "user-1", market: "Forex" });
    expect(ctx.version).toBe(coachContextService.CONTEXT_VERSION);
    expect(ctx.market).toBe("Forex");
    expect(ctx.streak.journal.current).toBe(5);
    expect(ctx.analytics.winRate).toBe(50);
    expect(ctx.analytics.psychology.score).toBe(62);
    expect(ctx.analytics.psychologyCost.biggestLeak.name).toBe("FOMO entries");
    expect(ctx.reflections).toHaveLength(1);
    expect(ctx.reflections[0].followedPlan).toBe("yes");
    expect(ctx.latestWeeklyReport.summary).toMatch(/Choppy week/);
  });

  it("produces a digest with byte size and source hash", async () => {
    const ctx = await coachContextService.buildContext({ userId: "user-1", market: "Forex" });
    const digest = coachContextService.digest(ctx);
    expect(digest.contextVersion).toBe(coachContextService.CONTEXT_VERSION);
    expect(digest.bytes).toBeGreaterThan(0);
    expect(digest.sourceHash).toMatch(/^[a-f0-9]{40}$/);
  });
});
