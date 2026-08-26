const USER_ID = "507f1f77bcf86cd799439012";
const NOW = new Date("2026-08-23T12:00:00.000Z");

function trade(index, overrides = {}) {
  return {
    _id: `indian-${index}`,
    user: USER_ID,
    instrumentType: "EQUITY",
    pair: "RELIANCE",
    stockSymbol: "RELIANCE",
    profit: 100,
    brokerage: 10,
    sttTaxes: 5,
    entryBasis: "Plan",
    strategy: "Opening Range Breakout",
    setup: "Opening Range Breakout",
    session: "Opening",
    mood: 4,
    confidence: "High",
    emotionalTags: ["Calm"],
    wouldRetake: "Yes",
    tradeQuality: "Great",
    setupScore: 85,
    setupRules: [{ label: "Wait for confirmation", followed: true }],
    stopLoss: 100,
    takeProfit: 140,
    tradeDate: new Date(Date.UTC(2026, 7, index + 1, 4, 0, 0)),
    createdAt: new Date(Date.UTC(2026, 7, index + 1, 4, 1, 0)),
    ...overrides,
  };
}

function setupModel(trades = []) {
  jest.resetModules();
  const query = {
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    lean: jest.fn(() => query),
    limit: jest.fn(() => Promise.resolve(trades)),
  };
  const IndianTrade = { find: jest.fn(() => query) };
  jest.doMock("../../models/IndianTrade", () => IndianTrade);
  return {
    IndianTrade,
    query,
    service: require("../../services/indianIntelligenceService"),
  };
}

describe("Indian intelligence evidence engine", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test.each([
    [0, "insufficient"],
    [4, "insufficient"],
    [5, "early"],
    [9, "early"],
    [10, "developing"],
    [19, "developing"],
    [20, "moderate"],
    [39, "moderate"],
    [40, "strong"],
  ])("classifies a sample of %i as %s evidence", (sampleSize, expected) => {
    const { confidenceForSample } = setupModel().service;
    expect(confidenceForSample(sampleSize).key).toBe(expected);
  });

  test("returns a safe unlock state for an empty journal", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const result = buildIndianIntelligenceSummary([], { instrumentType: "EQUITY", now: NOW });

    expect(result).toMatchObject({
      marketType: "Indian_Market",
      instrumentType: "EQUITY",
      sample: { totalTrades: 0, pnlReadyTrades: 0 },
      doNow: null,
      strengths: [],
      leaks: [],
    });
    expect(result.confidence.key).toBe("insufficient");
    expect(result.unlockRequirements[0]).toMatchObject({ field: "trades", remaining: 5 });
  });

  test("does not treat null numeric fields as recorded zero values", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const result = buildIndianIntelligenceSummary([
      trade(0, {
        profit: null,
        brokerage: null,
        sttTaxes: null,
        mood: null,
        stopLoss: null,
        takeProfit: null,
      }),
    ], { instrumentType: "EQUITY", now: NOW });

    expect(result.sample.pnlReadyTrades).toBe(0);
    expect(result.dataQuality.coverage.profit.count).toBe(0);
    expect(result.dataQuality.coverage.costs.count).toBe(0);
    expect(result.dataQuality.coverage.mood.count).toBe(0);
    expect(result.dataQuality.coverage.riskPlan.count).toBe(0);
  });

  test("uses Indian net P&L after brokerage and taxes in evidence", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const trades = [
      ...Array.from({ length: 6 }, (_, i) => trade(i, { profit: 200, brokerage: 20, sttTaxes: 10 })),
      ...Array.from({ length: 5 }, (_, i) => trade(i + 6, {
        entryBasis: i % 2 ? "Emotion" : "Impulsive",
        profit: -100,
        brokerage: 20,
        sttTaxes: 10,
        mood: 2,
        confidence: "Overconfident",
        emotionalTags: ["FOMO"],
        wouldRetake: "No",
        tradeQuality: "Poor",
      })),
    ];

    const result = buildIndianIntelligenceSummary(trades, { instrumentType: "EQUITY", now: NOW });
    const disciplineLeak = result.leaks.find((item) => item.dimension === "entryBasis");

    expect(result.sample.netPnl).toBe(370);
    expect(disciplineLeak).toEqual(expect.objectContaining({
      category: "leak",
      sampleSize: 5,
      financialImpact: 650,
      confidence: expect.objectContaining({ key: "early" }),
    }));
    expect(disciplineLeak.evidence).toContain("5 trades");
  });

  test("does not promote cohorts below the five-trade evidence floor", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const trades = [
      ...Array.from({ length: 8 }, (_, i) => trade(i)),
      ...Array.from({ length: 4 }, (_, i) => trade(i + 8, {
        entryBasis: "Emotion",
        profit: -500,
        emotionalTags: ["FOMO"],
      })),
    ];

    const result = buildIndianIntelligenceSummary(trades, { instrumentType: "EQUITY", now: NOW });

    expect(result.leaks.some((item) => item.dimension === "entryBasis")).toBe(false);
    expect(result.dataQuality.suppressedSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "entryBasis", sampleSize: 4 }),
    ]));
  });

  test("marks directionally consistent cohorts as stable and reversals as unstable", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const stableTrades = Array.from({ length: 10 }, (_, i) => trade(i, { strategy: "VWAP Pullback", setup: "VWAP Pullback", profit: 200 }));
    const unstableTrades = Array.from({ length: 10 }, (_, i) => trade(i + 10, {
      strategy: "Range Breakout",
      setup: "Range Breakout",
      profit: i < 5 ? 500 : -600,
    }));

    const result = buildIndianIntelligenceSummary([...stableTrades, ...unstableTrades], { instrumentType: "EQUITY", now: NOW });
    const stable = result.strengths.find((item) => item.key === "VWAP Pullback");
    const unstable = [...result.strengths, ...result.leaks].find((item) => item.key === "Range Breakout");

    expect(stable.stability.key).toBe("stable");
    expect(unstable.stability.key).toBe("unstable");
    expect(unstable.evidenceScore).toBeLessThan(stable.evidenceScore);
  });

  test("deduplicates correlated mindset signals and ranks the controllable action first", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const trades = [
      ...Array.from({ length: 10 }, (_, i) => trade(i, { profit: 250 })),
      ...Array.from({ length: 6 }, (_, i) => trade(i + 10, {
        entryBasis: "Emotion",
        mood: 2,
        confidence: "Overconfident",
        emotionalTags: ["FOMO", "Greed"],
        profit: -600,
        setupScore: 25,
      })),
    ];

    const result = buildIndianIntelligenceSummary(trades, { instrumentType: "EQUITY", now: NOW });
    const keys = [...result.strengths, ...result.leaks].map((item) => `${item.category}:${item.theme}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(result.doNow).toMatchObject({ category: "leak", theme: "discipline" });
    expect(result.guardrails[0].action).toMatch(/checklist|planned/i);
  });

  test("reports field coverage and progress without claiming causation", () => {
    const { buildIndianIntelligenceSummary } = setupModel().service;
    const trades = Array.from({ length: 20 }, (_, i) => trade(i, {
      entryBasis: i < 10 ? "Emotion" : "Plan",
      profit: i < 10 ? -100 : 150,
      mistakeTag: i % 2 ? "Held too long" : "",
      emotionalTags: i < 10 ? [] : ["Calm"],
    }));

    const result = buildIndianIntelligenceSummary(trades, { instrumentType: "EQUITY", now: NOW });

    expect(result.dataQuality.coverage.mistakeTag).toMatchObject({ count: 10, percentage: 50 });
    expect(result.dataQuality.coverage.emotionalTags).toMatchObject({ count: 10, percentage: 50 });
    expect(result.progress.planAdherence.changePct).toBe(100);
    expect(JSON.stringify(result)).not.toMatch(/caused|guarantee|proven edge/i);
  });

  test("queries only active IndianTrade documents for the authenticated user and instrument", async () => {
    const rows = [trade(0)];
    const { service, IndianTrade, query } = setupModel(rows);

    const result = await service.getIndianIntelligenceSummary({
      userId: USER_ID,
      instrumentType: "equity",
      now: NOW,
    });

    expect(IndianTrade.find).toHaveBeenCalledWith({
      user: USER_ID,
      deletedAt: null,
      instrumentType: "EQUITY",
    });
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("entryBasis"));
    expect(query.sort).toHaveBeenCalledWith({ tradeDate: 1, createdAt: 1, _id: 1 });
    expect(query.limit).toHaveBeenCalledWith(10000);
    expect(result.marketType).toBe("Indian_Market");
  });

  test("rejects missing users and invalid Indian instrument filters", async () => {
    const { service, IndianTrade } = setupModel();

    await expect(service.getIndianIntelligenceSummary({ instrumentType: "EQUITY" }))
      .rejects.toThrow("userId is required");
    await expect(service.getIndianIntelligenceSummary({ userId: USER_ID, instrumentType: "FOREX" }))
      .rejects.toThrow("Invalid Indian instrumentType");
    expect(IndianTrade.find).not.toHaveBeenCalled();
  });
});
