const {
  calculateBucketStats,
  calculateDisciplineScore,
  calculatePerformanceMetrics,
  calculatePsychologyScore,
  calculateSetupScore,
  mergePerformanceMetrics,
} = require("../../utils/metricEngine");

function trade(overrides = {}) {
  return {
    _id: overrides._id || "trade",
    pair: "EURUSD",
    profit: 0,
    commission: 0,
    swap: 0,
    brokerage: 0,
    sttTaxes: 0,
    emotionalTags: [],
    setupRules: [],
    ...overrides,
  };
}

describe("metric engine", () => {
  test("returns stable zero-trade performance metrics", () => {
    expect(calculatePerformanceMetrics([])).toMatchObject({
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakEven: 0,
      winRate: 0,
      grossPnL: 0,
      fees: 0,
      netPnL: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      expectancy: 0,
    });
  });

  test("calculates canonical Forex performance metrics", () => {
    const metrics = calculatePerformanceMetrics([
      trade({ _id: "a", profit: 100, commission: 2, swap: 1 }),
      trade({ _id: "b", profit: -50, commission: 1 }),
      trade({ _id: "c", profit: 0 }),
      trade({ _id: "d", profit: 25, commission: 0.5 }),
    ], "Forex");

    // Forex profit is already net of commission/swap at save time (see
    // deriveForexProfit) -- netPnL sums the stored profit as-is (75) and
    // grossPnL adds the fees back as a pre-cost estimate (79.5).
    expect(metrics).toMatchObject({
      totalTrades: 4,
      wins: 2,
      losses: 1,
      breakEven: 1,
      winRate: 50,
      grossPnL: 79.5,
      fees: 4.5,
      netPnL: 75,
      avgPnL: 18.75,
      avgWin: 62.5,
      avgLoss: 50,
      profitFactor: 2.5,
      expectancy: 18.75,
    });
  });

  test("uses market-specific costs but shared core formulas", () => {
    const indianMetrics = calculatePerformanceMetrics([
      trade({ profit: 1000, brokerage: 20, sttTaxes: 5 }),
      trade({ profit: -500, brokerage: 15, sttTaxes: 5 }),
    ], "Indian_Market");

    // Indian is the mirror image of Forex: stored profit is GROSS, so grossPnL
    // sums it as-is (500), brokerage+sttTaxes total 45, and netPnL is 455.
    expect(indianMetrics).toMatchObject({
      totalTrades: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      grossPnL: 500,
      fees: 45,
      netPnL: 455,
      avgWin: 1000,
      avgLoss: 500,
      profitFactor: 2,
    });
  });

  test("merges market metrics without changing definitions", () => {
    const forex = calculatePerformanceMetrics([trade({ profit: 100 }), trade({ profit: -25 })]);
    const indian = calculatePerformanceMetrics([trade({ profit: 50 }), trade({ profit: 0 })], "Indian_Market");

    expect(mergePerformanceMetrics([forex, indian])).toMatchObject({
      totalTrades: 4,
      wins: 2,
      losses: 1,
      breakEven: 1,
      winRate: 50,
      grossPnL: 125,
      avgWin: 75,
      avgLoss: 25,
      profitFactor: 6,
    });
  });

  test("calculates setup, discipline, psychology, and bucket stats from shared primitives", () => {
    const rows = [
      trade({
        profit: 100,
        emotionalTags: ["Calm"],
        setupScore: 100,
        setupRules: [{ label: "Trend", followed: true }, { label: "Risk", followed: true }],
      }),
      trade({
        profit: -50,
        emotionalTags: ["FOMO"],
        setupScore: 50,
        setupRules: [{ label: "Trend", followed: false }, { label: "Risk", followed: true }],
      }),
    ];

    expect(calculateSetupScore(rows[0].setupRules)).toBe(100);
    expect(calculateDisciplineScore(rows)).toBe(75);
    expect(calculatePsychologyScore(rows)).toBe(60);
    expect(calculateBucketStats(rows.map((row) => row.profit))).toMatchObject({
      count: 2,
      wins: 1,
      losses: 1,
      winRate: 50,
      netPnL: 50,
      avgPnL: 25,
    });
  });
});
