jest.mock("../../models/Trade", () => ({}));
jest.mock("../../models/IndianTrade", () => ({}));
jest.mock("../../utils/cache", () => ({
  buildCacheKey: (...parts) => parts.filter(Boolean).join(":"),
  rememberCache: jest.fn(async (_key, _ttl, resolver) => ({ data: await resolver(), cacheHit: false })),
}));
jest.mock("../../utils/cacheUtils", () => ({
  getTradeCacheVersion: jest.fn().mockResolvedValue("1"),
}));
jest.mock("../../repositories/weeklyReport.repository", () => ({}));
jest.mock("../../services/geminiService", () => ({
  generateWeeklyFeedback: jest.fn(),
}));
jest.mock("../../config", () => ({
  appConfig: { timezoneOffsetHours: 0 },
}));

const { calculatePerformanceMetrics, calculatePsychologyScore } = require("../../utils/metricEngine");
const { generateSnapshotFromTrades } = require("../../services/analyticsSnapshotService");
const { computeSnapshot: computeWeeklySnapshot } = require("../../services/weeklyReport.service");
const { computeTradingDNA } = require("../../utils/tradingDNA");
const {
  computeBucketDiscipline,
  computeBucketPnL,
  computeBucketPsychologyScore,
} = require("../../utils/psychologyTimeline");

function makeTrades(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `trade-${index}`,
    pair: index % 2 === 0 ? "EURUSD" : "GBPUSD",
    profit: [120, -50, 0, 80, -30][index % 5],
    commission: index % 2 === 0 ? 2 : 1,
    swap: 0,
    brokerage: 0,
    sttTaxes: 0,
    session: index % 2 === 0 ? "London" : "New York",
    strategy: index % 2 === 0 ? "Breakout" : "Pullback",
    tradeDate: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    createdAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T01:00:00.000Z`),
    emotionalTags: index % 2 === 0 ? ["Calm"] : ["FOMO"],
    confidence: index % 2 === 0 ? "High" : "Low",
    mood: index % 2 === 0 ? 4 : 2,
    setupRules: [{ label: "Trend", followed: index % 2 === 0 }],
    setupScore: index % 2 === 0 ? 90 : 40,
    entryBasis: index % 2 === 0 ? "Plan" : "Emotion",
    tradeQuality: index % 2 === 0 ? "Great" : "Poor",
    wouldRetake: index % 2 === 0 ? "Yes" : "No",
  }));
}

describe("metric consistency across modules", () => {
  test("dashboard, analytics, timeline, DNA, and weekly reports share core performance metrics", () => {
    const trades = makeTrades(5);
    const engine = calculatePerformanceMetrics(trades, "Forex");
    const analytics = generateSnapshotFromTrades({ trades, marketLabel: "Forex", period: "weekly" });
    const weekly = computeWeeklySnapshot(trades, "Forex", analytics);
    const dna = computeTradingDNA(trades, "Forex", analytics.selfAwareness);
    const timelinePnl = computeBucketPnL(trades);

    expect(analytics.performance).toMatchObject({
      totalTrades: engine.totalTrades,
      wins: engine.wins,
      losses: engine.losses,
      breakEven: engine.breakEven,
      winRate: engine.winRate,
      grossPnL: engine.grossPnL,
      netPnL: engine.netPnL,
      avgWin: engine.avgWin,
      avgLoss: engine.avgLoss,
      profitFactor: engine.profitFactor,
    });

    expect(weekly.counts).toEqual({
      totalTrades: engine.totalTrades,
      wins: engine.wins,
      losses: engine.losses,
      breakEven: engine.breakEven,
    });
    expect(weekly.pnl.net).toBe(engine.netPnL);
    expect(weekly.rates).toMatchObject({
      winRatePct: engine.winRate,
      avgWin: engine.avgWin,
      avgLoss: engine.avgLoss,
      profitFactor: engine.profitFactor,
    });

    expect(timelinePnl).toMatchObject({
      tradeCount: engine.totalTrades,
      winRate: engine.winRate,
      net: engine.grossPnL,
    });

    expect(dna.totalTrades).toBe(engine.totalTrades);
  });

  test("weekly reports consume analytics snapshot metrics instead of recalculating raw trades", () => {
    const trades = makeTrades(5);
    const analytics = generateSnapshotFromTrades({
      trades: trades.slice(0, 3),
      marketLabel: "Forex",
      period: "weekly",
    });

    const weekly = computeWeeklySnapshot(trades, "Forex", analytics);

    expect(weekly.source.metricSource).toBe("analytics_snapshot");
    expect(weekly.counts.totalTrades).toBe(analytics.performance.totalTrades);
    expect(weekly.counts.totalTrades).not.toBe(trades.length);
    expect(weekly.pnl.net).toBe(analytics.performance.netPnL);
    expect(weekly.rates.winRatePct).toBe(analytics.performance.winRate);
  });

  test("psychology and discipline formulas are shared by timeline and metric engine", () => {
    const trades = makeTrades(5);

    expect(computeBucketPsychologyScore(trades)).toBe(calculatePsychologyScore(trades));
    expect(computeBucketDiscipline(trades)).toBe(65);
  });

  test("edge cases stay deterministic", () => {
    for (const count of [0, 1, 5, 100, 1000]) {
      const rows = makeTrades(count);
      const engine = calculatePerformanceMetrics(rows, "Forex");
      const analytics = generateSnapshotFromTrades({ trades: rows, marketLabel: "Forex", period: "weekly" });

      expect(analytics.performance.totalTrades).toBe(engine.totalTrades);
      expect(analytics.performance.winRate).toBe(engine.winRate);
      expect(analytics.performance.netPnL).toBe(engine.netPnL);
    }
  });
});
