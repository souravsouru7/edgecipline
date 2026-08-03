const validUserId = "507f1f77bcf86cd799439012";

function makeQuery(result) {
  const query = {
    sort: jest.fn(() => query),
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    limit: jest.fn(() => Promise.resolve(result)),
  };
  return query;
}

function makeTrades(count, marketType = "Forex") {
  return Array.from({ length: count }, (_, index) => ({
    _id: `trade-${index}`,
    user: validUserId,
    marketType,
    pair: marketType === "Indian_Market" ? "NIFTY" : "EURUSD",
    profit: index % 2 === 0 ? 100 : -50,
    commission: marketType === "Indian_Market" ? 0 : 2,
    swap: 0,
    brokerage: marketType === "Indian_Market" ? 5 : 0,
    sttTaxes: marketType === "Indian_Market" ? 1 : 0,
    tradeDate: new Date(`2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
    createdAt: new Date(`2026-01-${String((index % 28) + 1).padStart(2, "0")}T01:00:00.000Z`),
    emotionalTags: index % 3 === 0 ? ["Calm"] : ["FOMO"],
    confidence: index % 2 === 0 ? "High" : "Low",
    mood: index % 2 === 0 ? 4 : 2,
    setupRules: [{ label: "Trend", followed: index % 2 === 0 }],
    setupScore: index % 2 === 0 ? 90 : 30,
    entryBasis: index % 2 === 0 ? "Plan" : "Emotion",
    tradeQuality: index % 2 === 0 ? "Great" : "Poor",
  }));
}

function makePerformanceAggregate(trades, marketType = "Forex") {
  const feesFor = (trade) => marketType === "Indian_Market"
    ? (trade.brokerage || 0) + (trade.sttTaxes || 0)
    : (trade.commission || 0) + (trade.swap || 0);
  return [{
    totalTrades: trades.length,
    pnlReadyTrades: trades.filter((trade) => trade.profit != null).length,
    wins: trades.filter((trade) => trade.profit > 0).length,
    losses: trades.filter((trade) => trade.profit < 0).length,
    breakEven: trades.filter((trade) => trade.profit === 0).length,
    grossPnL: trades.reduce((sum, trade) => sum + (trade.profit || 0), 0),
    fees: trades.reduce((sum, trade) => sum + feesFor(trade), 0),
    netPnL: trades.reduce((sum, trade) => sum + (trade.profit || 0) - feesFor(trade), 0),
    totalVolume: trades.reduce((sum, trade) => sum + Math.abs(trade.profit || 0), 0),
    totalWinPnL: trades.filter((trade) => trade.profit > 0).reduce((sum, trade) => sum + trade.profit, 0),
    totalLossPnL: trades.filter((trade) => trade.profit < 0).reduce((sum, trade) => sum + trade.profit, 0),
    avgSetupScore: trades.length ? trades.reduce((sum, trade) => sum + (trade.setupScore || 0), 0) / trades.length : null,
  }];
}

function makeTimelineAggregate(trades) {
  return trades.slice(0, 2).map((trade, index) => ({
    bucket: trade.tradeDate,
    trades: index + 1,
    pnl: trade.profit,
    wins: trade.profit > 0 ? 1 : 0,
    losses: trade.profit < 0 ? 1 : 0,
    winRate: trade.profit > 0 ? 100 : 0,
    avgMood: trade.mood,
    avgSetupScore: trade.setupScore,
    planAdherencePct: trade.entryBasis === "Plan" ? 100 : 0,
    qualityPct: trade.tradeQuality === "Poor" ? 0 : 100,
  }));
}

function makePnlBreakdownAggregate(trades) {
  return [{
    daily: trades.slice(0, 2).map((trade) => ({
      date: trade.tradeDate.toISOString().split("T")[0],
      profit: trade.profit,
    })),
    weekly: [{ week: "2026-W01", profit: trades.reduce((sum, trade) => sum + trade.profit, 0) }],
    monthly: [{ year: 2026, monthNumber: 1, profit: trades.reduce((sum, trade) => sum + trade.profit, 0) }],
  }];
}

function makeTradeDistributionAggregate(trades) {
  const groupBy = (field) => {
    const map = new Map();
    for (const trade of trades) {
      const key = trade[field] || "Unspecified";
      const row = map.get(key) || { key, total: 0, wins: 0, losses: 0, profit: 0 };
      row.total += 1;
      row.profit += trade.profit || 0;
      if ((trade.profit || 0) > 0) row.wins += 1;
      if ((trade.profit || 0) < 0) row.losses += 1;
      map.set(key, row);
    }
    return Array.from(map.values());
  };

  return [{
    byPair: groupBy("pair"),
    byType: groupBy("type"),
    byStrategy: groupBy("strategy"),
    bySession: groupBy("session"),
    byTradeType: groupBy("tradeType"),
    byEntryBasis: groupBy("entryBasis"),
    byMistakeTag: groupBy("mistakeTag"),
    byUnderlying: groupBy("underlying"),
    byOptionType: groupBy("optionType"),
    byDirection: groupBy("type"),
    byStockSymbol: groupBy("stockSymbol"),
    bySector: groupBy("sector"),
  }];
}

function makeTradeQualityAggregate(trades) {
  const quality = new Map();
  for (const trade of trades.filter((item) => ["Great", "Average", "Poor"].includes(item.tradeQuality))) {
    const row = quality.get(trade.tradeQuality) || { key: trade.tradeQuality, total: 0, wins: 0, losses: 0, profit: 0 };
    row.total += 1;
    row.profit += trade.profit || 0;
    if ((trade.profit || 0) > 0) row.wins += 1;
    if ((trade.profit || 0) < 0) row.losses += 1;
    quality.set(trade.tradeQuality, row);
  }

  return [{ total: [{ count: trades.length }], quality: Array.from(quality.values()) }];
}

describe("AnalyticsSnapshotService", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setup({ forexTrades = [], indianTrades = [], version = "0", cacheHit = false } = {}) {
    const cacheStore = new Map();
    const Trade = {
      find: jest.fn(() => makeQuery(forexTrades)),
      aggregate: jest.fn((pipeline = []) => {
        const usesFacet = pipeline.some((stage) => stage.$facet);
        const usesDateTrunc = JSON.stringify(pipeline).includes("$dateTrunc");
        const pipelineText = JSON.stringify(pipeline);
        if (usesFacet && pipelineText.includes("daily") && pipelineText.includes("monthly")) {
          return Promise.resolve(makePnlBreakdownAggregate(forexTrades));
        }
        if (usesFacet && pipelineText.includes("byPair") && pipelineText.includes("bySession")) {
          return Promise.resolve(makeTradeDistributionAggregate(forexTrades));
        }
        if (usesFacet && pipelineText.includes("quality") && pipelineText.includes("tradeQuality")) {
          return Promise.resolve(makeTradeQualityAggregate(forexTrades));
        }
        if (usesFacet) return Promise.resolve([{ overview: makePerformanceAggregate(forexTrades), brokenRules: [], followedRules: [] }]);
        if (usesDateTrunc) return Promise.resolve(makeTimelineAggregate(forexTrades));
        return Promise.resolve(makePerformanceAggregate(forexTrades));
      }),
    };
    const IndianTrade = {
      find: jest.fn(() => makeQuery(indianTrades)),
      aggregate: jest.fn((pipeline = []) => {
        const usesFacet = pipeline.some((stage) => stage.$facet);
        const usesDateTrunc = JSON.stringify(pipeline).includes("$dateTrunc");
        const pipelineText = JSON.stringify(pipeline);
        if (usesFacet && pipelineText.includes("daily") && pipelineText.includes("monthly")) {
          return Promise.resolve(makePnlBreakdownAggregate(indianTrades));
        }
        if (usesFacet && pipelineText.includes("byPair") && pipelineText.includes("bySession")) {
          return Promise.resolve(makeTradeDistributionAggregate(indianTrades));
        }
        if (usesFacet && pipelineText.includes("quality") && pipelineText.includes("tradeQuality")) {
          return Promise.resolve(makeTradeQualityAggregate(indianTrades));
        }
        if (usesFacet) return Promise.resolve([{ overview: makePerformanceAggregate(indianTrades, "Indian_Market"), brokenRules: [], followedRules: [] }]);
        if (usesDateTrunc) return Promise.resolve(makeTimelineAggregate(indianTrades));
        return Promise.resolve(makePerformanceAggregate(indianTrades, "Indian_Market"));
      }),
    };

    jest.doMock("../../models/Trade", () => Trade);
    jest.doMock("../../models/IndianTrade", () => IndianTrade);
    jest.doMock("../../utils/cacheUtils", () => ({
      getTradeCacheVersion: jest.fn().mockResolvedValue(version),
    }));
    jest.doMock("../../utils/cache", () => ({
      buildCacheKey: (...parts) => parts.filter(Boolean).join(":"),
      rememberCache: jest.fn(async (key, ttl, resolver) => {
        if (cacheHit && cacheStore.has(key)) {
          return { data: cacheStore.get(key), cacheHit: true };
        }
        const data = await resolver();
        cacheStore.set(key, data);
        return { data, cacheHit: false };
      }),
    }));
    jest.doMock("../../config", () => ({
      appConfig: { timezoneOffsetHours: 0 },
    }));

    return {
      Trade,
      IndianTrade,
      cacheStore,
      service: require("../../services/analyticsSnapshotService"),
      cache: require("../../utils/cache"),
      cacheUtils: require("../../utils/cacheUtils"),
    };
  }

  test("generates a Forex snapshot from one projected trade load", async () => {
    const { service, Trade } = setup({ forexTrades: makeTrades(5), version: "7" });

    const snapshot = await service.getSnapshot({ userId: validUserId, market: "Forex" });

    expect(Trade.find).toHaveBeenCalledTimes(1);
    expect(snapshot.sourceTradeCount).toBe(5);
    expect(snapshot.performance.totalTrades).toBe(5);
    expect(snapshot.psychologyCost).toBeTruthy();
    expect(snapshot.tradingDNA).toBeTruthy();
    expect(snapshot.patterns).toBeTruthy();
    expect(snapshot.timeline).toBeTruthy();
    expect(snapshot.cache.key).toContain("analytics_snapshot");
    expect(snapshot.cache.version).toBe("7");
  });

  test("uses cache on repeated snapshot key", async () => {
    const context = setup({ forexTrades: makeTrades(3), cacheHit: true });

    await context.service.getSnapshot({ userId: validUserId, market: "Forex" });
    await context.service.getSnapshot({ userId: validUserId, market: "Forex" });

    expect(context.cache.rememberCache).toHaveBeenCalledTimes(2);
    expect(context.Trade.find).toHaveBeenCalledTimes(1);
  });

  test("cache invalidation changes the versioned key", async () => {
    const context = setup({ forexTrades: makeTrades(2), version: "1" });
    context.cacheUtils.getTradeCacheVersion.mockResolvedValueOnce("1").mockResolvedValueOnce("2");

    const first = await context.service.getSnapshot({ userId: validUserId, market: "Forex" });
    const second = await context.service.getSnapshot({ userId: validUserId, market: "Forex" });

    expect(first.cache.key).toContain("v1");
    expect(second.cache.key).toContain("v2");
    expect(context.Trade.find).toHaveBeenCalledTimes(2);
  });

  test("loads Indian snapshots from IndianTrade with instrument filter", async () => {
    const { service, IndianTrade, Trade } = setup({ indianTrades: makeTrades(4, "Indian_Market") });

    const snapshot = await service.getSnapshot({
      userId: validUserId,
      market: "Indian_Market",
      instrumentType: "equity",
    });

    expect(Trade.find).not.toHaveBeenCalled();
    expect(IndianTrade.find).toHaveBeenCalledWith(expect.objectContaining({ instrumentType: "EQUITY" }));
    expect(snapshot.marketType).toBe("Indian_Market");
    expect(snapshot.sourceTradeCount).toBe(4);
  });

  test("counts Indian trades with missing P&L without using them in win-rate math", async () => {
    const indianTrades = [
      ...makeTrades(2, "Indian_Market"),
      { ...makeTrades(1, "Indian_Market")[0], _id: "missing-profit", profit: undefined },
    ];
    const { service } = setup({ indianTrades });

    const snapshot = await service.getSnapshot({ userId: validUserId, market: "Indian_Market" });

    expect(snapshot.performance.totalTrades).toBe(3);
    expect(snapshot.performance.pnlReadyTrades).toBe(2);
    expect(snapshot.performance.tradesMissingPnl).toBe(1);
    expect(snapshot.performance.winRate).toBe(50);
    expect(snapshot.performance.netPnL).toBe(38);
  });

  test("combined snapshot loads Forex and Indian once each", async () => {
    const { service, Trade, IndianTrade } = setup({
      forexTrades: makeTrades(2),
      indianTrades: makeTrades(3, "Indian_Market"),
    });

    const snapshot = await service.getSnapshot({ userId: validUserId, market: "combined" });

    expect(Trade.find).toHaveBeenCalledTimes(1);
    expect(IndianTrade.find).toHaveBeenCalledTimes(1);
    expect(snapshot.sourceTradeCount).toBe(5);
    expect(snapshot.cache.queryCount).toBe(2);
  });

  test("handles zero and large datasets without changing metric primitives", async () => {
    const empty = setup({ forexTrades: [] });
    const emptySnapshot = await empty.service.getSnapshot({ userId: validUserId, market: "Forex" });
    expect(emptySnapshot.performance).toMatchObject({ totalTrades: 0, winRate: 0, netPnL: 0 });

    jest.resetModules();
    const large = setup({ forexTrades: makeTrades(10000) });
    const largeSnapshot = await large.service.getSnapshot({ userId: validUserId, market: "Forex" });

    expect(largeSnapshot.sourceTradeCount).toBe(10000);
    expect(largeSnapshot.performance.totalTrades).toBe(10000);
    expect(largeSnapshot.basicStats).toEqual(largeSnapshot.performance);
  });

  test("performance snapshot uses MongoDB aggregation instead of loading trades", async () => {
    const { service, Trade } = setup({ forexTrades: makeTrades(1000) });

    const snapshot = await service.getPerformanceSnapshot({ userId: validUserId, market: "Forex" });

    expect(Trade.aggregate).toHaveBeenCalledTimes(1);
    expect(Trade.find).not.toHaveBeenCalled();
    expect(snapshot.performance.totalTrades).toBe(1000);
    expect(snapshot.performance.winRate).toBe(50);
    expect(snapshot.cache.key).toContain("analytics_aggregate:performance");
  });

  // The timeline deliberately loads trades rather than using a $group pipeline:
  // psychology, self-awareness and discipline scores are derived per bucket by
  // computePsychologyTimeline and cannot be produced by the aggregation, which
  // only emitted raw pnl/trade counts under different field names. Every chart
  // on the page bound to fields that pipeline never returned.
  test("timeline snapshot returns scored buckets from computePsychologyTimeline", async () => {
    const { service, IndianTrade } = setup({ indianTrades: makeTrades(5, "Indian_Market") });

    const snapshot = await service.getTimelineSnapshot({
      userId: validUserId,
      market: "Indian_Market",
      instrumentType: "OPTION",
      period: "monthly",
    });

    expect(IndianTrade.find).toHaveBeenCalled();
    expect(snapshot.timeline.buckets.length).toBeGreaterThan(0);
    expect(snapshot.cache.key).toContain("analytics_aggregate:timeline");

    // The fields the timeline charts actually read.
    const bucket = snapshot.timeline.buckets[0];
    expect(bucket).toEqual(expect.objectContaining({
      key: expect.any(String),
      tradeCount: expect.any(Number),
      psychologyScore: expect.any(Number),
      selfAwarenessScore: expect.any(Number),
      disciplineScore: expect.any(Number),
      net: expect.any(Number),
    }));

    // Score averages were previously hardcoded null, and the user-facing
    // summary read "Timeline generated from MongoDB aggregation buckets."
    expect(snapshot.timeline.stats.avgPsychologyScore).toEqual(expect.any(Number));
    expect(snapshot.timeline.aiSummary).not.toMatch(/MongoDB/i);
  });

  test("discipline summary uses MongoDB facet aggregation", async () => {
    const { service, Trade } = setup({ forexTrades: makeTrades(10) });

    const snapshot = await service.getDisciplineSummarySnapshot({ userId: validUserId, market: "Forex" });

    expect(Trade.aggregate).toHaveBeenCalledTimes(1);
    expect(snapshot.disciplineSummary.totalTrades).toBe(10);
    expect(snapshot.cache.key).toContain("analytics_aggregate:discipline");
  });

  test("P&L breakdown uses MongoDB facet aggregation", async () => {
    const { service, IndianTrade } = setup({ indianTrades: makeTrades(4, "Indian_Market") });

    const snapshot = await service.getPnlBreakdownSnapshot({
      userId: validUserId,
      market: "Indian_Market",
      instrumentType: "OPTION",
    });

    expect(IndianTrade.aggregate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(IndianTrade.aggregate.mock.calls[0][0])).toContain("Asia/Kolkata");
    expect(snapshot.daily).toHaveLength(2);
    expect(snapshot.weekly[0]).toHaveProperty("week", "2026-W01");
    expect(snapshot.monthly[0]).toMatchObject({ month: "Jan 2026" });
    expect(snapshot.cache.key).toContain("analytics_aggregate:pnl_breakdown");
  });

  test("trade distribution uses MongoDB facet aggregation", async () => {
    const { service, Trade } = setup({ forexTrades: makeTrades(6) });

    const snapshot = await service.getTradeDistributionSnapshot({ userId: validUserId, market: "Forex" });

    expect(Trade.aggregate).toHaveBeenCalledTimes(1);
    expect(Trade.find).not.toHaveBeenCalled();
    expect(snapshot.distribution.byPair.EURUSD.total).toBe(6);
    expect(snapshot.cache.key).toContain("analytics_aggregate:trade_distribution");
  });

  test("trade quality uses MongoDB facet aggregation", async () => {
    const { service, IndianTrade } = setup({ indianTrades: makeTrades(5, "Indian_Market") });

    const snapshot = await service.getTradeQualitySnapshot({
      userId: validUserId,
      market: "Indian_Market",
      instrumentType: "OPTION",
    });

    expect(IndianTrade.aggregate).toHaveBeenCalledTimes(1);
    expect(IndianTrade.find).not.toHaveBeenCalled();
    expect(snapshot.quality.distribution.Great.count).toBe(3);
    expect(snapshot.quality.distribution.Poor.count).toBe(2);
    expect(snapshot.cache.key).toContain("analytics_aggregate:trade_quality");
  });
});
