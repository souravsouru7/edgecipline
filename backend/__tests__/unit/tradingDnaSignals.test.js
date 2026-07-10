"use strict";

const {
  behaviorPatterns,
  buildPersonalityBundle,
  consistencyIndex,
  emotionalProfile,
  expectancy,
  filterCompletedTrades,
  monthlyEvolution,
  positionSizingProfile,
  quarterlyComparison,
  rankSessions,
  rankSetups,
  recoveryProfile,
  ruleAdherence,
  summarizeWindow,
} = require("../../utils/tradingDnaSignals");

function makeTrade(overrides = {}) {
  return {
    profit: 100,
    quantity: 1,
    entryPrice: 100,
    stopLoss: 99,
    strategy: "Breakout",
    session: "London",
    setupScore: 80,
    entryBasis: "Plan",
    mood: 4,
    confidence: "Medium",
    emotionalTags: ["Calm"],
    wouldRetake: "Yes",
    tradeQuality: "Great",
    setupRules: [
      { label: "Trend Alignment", followed: true },
      { label: "Volume Check", followed: true },
    ],
    effectiveTradeDate: new Date("2026-03-15T10:00:00Z"),
    tradeDate: new Date("2026-03-15T10:00:00Z"),
    createdAt: new Date("2026-03-15T10:00:00Z"),
    ...overrides,
  };
}

function dayOffset(baseISO, days, hours = 10) {
  const base = new Date(baseISO);
  base.setUTCDate(base.getUTCDate() + days);
  base.setUTCHours(hours, 0, 0, 0);
  return base;
}

describe("tradingDnaSignals - filterCompletedTrades", () => {
  test("includes Forex trades only when status is completed", () => {
    const input = [
      { profit: 100, status: "completed" },
      { profit: 50, status: "pending" },
      { profit: -20, status: "processing" },
      { profit: 75, status: "failed" },
      { profit: 30, status: "completed" },
    ];
    const out = filterCompletedTrades(input);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.profit)).toEqual([100, 30]);
  });

  test("treats Indian-style rows with no status field as completed", () => {
    const input = [
      { profit: 100 }, // no status — Indian trade
      { profit: 50, status: null }, // explicit null — still include
      { profit: -20, status: "pending" },
      { profit: 30 },
    ];
    const out = filterCompletedTrades(input);
    expect(out).toHaveLength(3);
    expect(out.map((t) => t.profit)).toEqual([100, 50, 30]);
  });

  test("returns an empty array for non-array input", () => {
    expect(filterCompletedTrades(null)).toEqual([]);
    expect(filterCompletedTrades(undefined)).toEqual([]);
    expect(filterCompletedTrades({})).toEqual([]);
  });

  test("returns an empty array when all trades are non-completed", () => {
    const input = [
      { profit: 100, status: "pending" },
      { profit: 50, status: "processing" },
    ];
    expect(filterCompletedTrades(input)).toEqual([]);
  });
});

describe("tradingDnaSignals - expectancy", () => {
  test("returns 0 for empty input", () => {
    expect(expectancy([])).toBe(0);
  });

  test("positive when wins outweigh losses", () => {
    const trades = [
      makeTrade({ profit: 200 }),
      makeTrade({ profit: 200 }),
      makeTrade({ profit: -100 }),
    ];
    expect(expectancy(trades)).toBeGreaterThan(0);
  });

  test("negative when losses dominate", () => {
    const trades = [
      makeTrade({ profit: -200 }),
      makeTrade({ profit: -200 }),
      makeTrade({ profit: 50 }),
    ];
    expect(expectancy(trades)).toBeLessThan(0);
  });
});

describe("tradingDnaSignals - rankSetups", () => {
  test("returns nulls when no setup hits the minimum sample", () => {
    const trades = [makeTrade({ strategy: "Breakout" })];
    const ranked = rankSetups(trades);
    expect(ranked.best).toBeNull();
    expect(ranked.worst).toBeNull();
    expect(ranked.top).toEqual([]);
  });

  test("ranks setups by expectancy and surfaces best + worst", () => {
    const trades = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade({ strategy: "Breakout", profit: i % 2 === 0 ? 300 : -100 })
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeTrade({ strategy: "Reversal", profit: i % 3 === 0 ? 100 : -200 })
      ),
    ];
    const ranked = rankSetups(trades);
    expect(ranked.best.name).toBe("Breakout");
    expect(ranked.worst.name).toBe("Reversal");
    expect(ranked.best.trades).toBe(6);
    expect(ranked.worst.expectancy).toBeLessThan(ranked.best.expectancy);
  });

  test("skips blank strategy labels", () => {
    const trades = Array.from({ length: 5 }, () =>
      makeTrade({ strategy: "" })
    );
    const ranked = rankSetups(trades);
    expect(ranked.best).toBeNull();
  });
});

describe("tradingDnaSignals - rankSessions", () => {
  test("orders sessions by expectancy", () => {
    const trades = [
      ...Array.from({ length: 4 }, () => makeTrade({ session: "London", profit: 200 })),
      ...Array.from({ length: 4 }, () => makeTrade({ session: "NY", profit: -100 })),
    ];
    const ranked = rankSessions(trades);
    expect(ranked.best.name).toBe("London");
    expect(ranked.worst.name).toBe("NY");
  });

  test("skips trades with no session label", () => {
    const trades = Array.from({ length: 3 }, () => makeTrade({ session: "" }));
    const ranked = rankSessions(trades);
    expect(ranked.all).toEqual([]);
  });
});

describe("tradingDnaSignals - ruleAdherence", () => {
  test("aggregates rule labels across trades", () => {
    const trades = [
      makeTrade({
        setupRules: [
          { label: "Trend", followed: true },
          { label: "Volume", followed: false },
        ],
      }),
      makeTrade({
        setupRules: [
          { label: "Trend", followed: true },
          { label: "Volume", followed: false },
        ],
      }),
      makeTrade({
        setupRules: [
          { label: "Trend", followed: false },
          { label: "Volume", followed: true },
        ],
      }),
    ];
    const rules = ruleAdherence(trades);
    const trend = rules.find((r) => r.label === "Trend");
    const volume = rules.find((r) => r.label === "Volume");
    expect(trend.total).toBe(3);
    expect(trend.followed).toBe(2);
    expect(trend.followedPct).toBeCloseTo(66.7, 1);
    expect(volume.followed).toBe(1);
  });

  test("ignores blank rule labels", () => {
    const trades = [
      makeTrade({ setupRules: [{ label: "", followed: true }] }),
    ];
    expect(ruleAdherence(trades)).toEqual([]);
  });
});

describe("tradingDnaSignals - recoveryProfile", () => {
  test("computes win rate on the trade immediately after a loss", () => {
    const trades = [
      makeTrade({ profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 0) }),
      makeTrade({ profit: 200, effectiveTradeDate: dayOffset("2026-03-01", 1) }),
      makeTrade({ profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 2) }),
      makeTrade({ profit: 200, effectiveTradeDate: dayOffset("2026-03-01", 3) }),
      makeTrade({ profit: 100, effectiveTradeDate: dayOffset("2026-03-01", 4) }),
    ];
    const recovery = recoveryProfile(trades);
    expect(recovery.afterLoss.sample).toBe(2);
    expect(recovery.afterLoss.winRate).toBe(100);
  });

  test("tracks two-loss streak recovery separately", () => {
    const trades = [
      makeTrade({ profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 0) }),
      makeTrade({ profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 1) }),
      makeTrade({ profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 2) }),
      makeTrade({ profit: 50, effectiveTradeDate: dayOffset("2026-03-01", 3) }),
    ];
    const recovery = recoveryProfile(trades);
    expect(recovery.afterTwoLosses.sample).toBe(2);
    expect(recovery.afterTwoLosses.winRate).toBe(50);
  });
});

describe("tradingDnaSignals - positionSizingProfile", () => {
  test("returns null below the minimum sample", () => {
    const trades = [makeTrade({ quantity: 1 })];
    expect(positionSizingProfile(trades)).toBeNull();
  });

  test("flags oversizing after losses", () => {
    const trades = [
      makeTrade({ quantity: 1, profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 0) }),
      makeTrade({ quantity: 3, profit: -200, effectiveTradeDate: dayOffset("2026-03-01", 1) }),
      makeTrade({ quantity: 1, profit: 100, effectiveTradeDate: dayOffset("2026-03-01", 2) }),
      makeTrade({ quantity: 1, profit: -100, effectiveTradeDate: dayOffset("2026-03-01", 3) }),
      makeTrade({ quantity: 4, profit: -300, effectiveTradeDate: dayOffset("2026-03-01", 4) }),
    ];
    const sizing = positionSizingProfile(trades);
    expect(sizing.sample).toBe(5);
    expect(sizing.postLossSample).toBeGreaterThan(0);
    expect(sizing.oversizeAfterLossPct).toBeGreaterThan(0);
  });
});

describe("tradingDnaSignals - consistencyIndex", () => {
  test("returns null below 3 active days", () => {
    const trades = [makeTrade(), makeTrade()];
    expect(consistencyIndex(trades)).toBeNull();
  });

  test("computes a coefficient of variation", () => {
    const trades = [
      makeTrade({ profit: 100, effectiveTradeDate: dayOffset("2026-03-01", 0) }),
      makeTrade({ profit: -50, effectiveTradeDate: dayOffset("2026-03-01", 1) }),
      makeTrade({ profit: 200, effectiveTradeDate: dayOffset("2026-03-01", 2) }),
    ];
    const c = consistencyIndex(trades);
    expect(c.activeDays).toBe(3);
    expect(c.dailyMean).not.toBeNull();
    expect(c.dailyStddev).toBeGreaterThan(0);
  });
});

describe("tradingDnaSignals - emotionalProfile", () => {
  test("aggregates tag frequency and P&L", () => {
    const trades = [
      makeTrade({ emotionalTags: ["FOMO"], profit: -150 }),
      makeTrade({ emotionalTags: ["FOMO"], profit: -200 }),
      makeTrade({ emotionalTags: ["Calm"], profit: 300 }),
    ];
    const profile = emotionalProfile(trades);
    const fomo = profile.topByFrequency.find((e) => e.tag === "FOMO");
    expect(fomo.count).toBe(2);
    expect(fomo.netPnL).toBe(-350);
    expect(profile.mostCostly[0].tag).toBe("FOMO");
    expect(profile.mostProfitable[0].tag).toBe("Calm");
  });

  test("collapses mixed-case duplicates and keeps first-seen casing", () => {
    const trades = [
      makeTrade({ emotionalTags: ["FOMO"], profit: -100 }),
      makeTrade({ emotionalTags: ["fomo"], profit: -50 }),
      makeTrade({ emotionalTags: ["Fomo"], profit: -25 }),
    ];
    const profile = emotionalProfile(trades);
    expect(profile.topByFrequency).toHaveLength(1);
    expect(profile.topByFrequency[0].tag).toBe("FOMO");
    expect(profile.topByFrequency[0].count).toBe(3);
    expect(profile.topByFrequency[0].netPnL).toBe(-175);
  });
});

describe("tradingDnaSignals - monthlyEvolution", () => {
  test("returns up to 6 most recent months", () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeTrade({
        effectiveTradeDate: new Date(Date.UTC(2026, i, 15)),
      })
    );
    const evo = monthlyEvolution(trades);
    expect(evo.length).toBe(6);
    // ordered ascending
    expect(evo[0].month < evo[evo.length - 1].month).toBe(true);
  });

  test("computes win rate and plan adherence per month", () => {
    const trades = [
      makeTrade({
        profit: 100,
        entryBasis: "Plan",
        effectiveTradeDate: new Date("2026-03-01T10:00:00Z"),
      }),
      makeTrade({
        profit: -100,
        entryBasis: "Emotion",
        effectiveTradeDate: new Date("2026-03-10T10:00:00Z"),
      }),
    ];
    const evo = monthlyEvolution(trades);
    // Single-month span — only March 2026 in the output.
    expect(evo).toHaveLength(1);
    expect(evo[0].month).toBe("2026-03");
    expect(evo[0].trades).toBe(2);
    expect(evo[0].winRate).toBe(50);
    expect(evo[0].planAdherencePct).toBe(50);
  });

  test("fills gap months between earliest and latest with null metrics", () => {
    const trades = [
      makeTrade({
        profit: 100,
        effectiveTradeDate: new Date("2026-03-15T10:00:00Z"),
      }),
      makeTrade({
        profit: 200,
        effectiveTradeDate: new Date("2026-06-15T10:00:00Z"),
      }),
      makeTrade({
        profit: -50,
        effectiveTradeDate: new Date("2026-08-15T10:00:00Z"),
      }),
    ];
    const evo = monthlyEvolution(trades);
    // March → August inclusive = 6 buckets, all present.
    expect(evo.map((e) => e.month)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    const april = evo.find((e) => e.month === "2026-04");
    expect(april.trades).toBe(0);
    expect(april.winRate).toBeNull();
    expect(april.planAdherencePct).toBeNull();
    expect(april.avgSetupScore).toBeNull();
    const june = evo.find((e) => e.month === "2026-06");
    expect(june.trades).toBe(1);
    expect(june.netPnL).toBe(200);
  });

  test("caps a long sparse range at the requested months limit", () => {
    const trades = [
      makeTrade({
        profit: 50,
        effectiveTradeDate: new Date("2025-08-01T10:00:00Z"),
      }),
      makeTrade({
        profit: 80,
        effectiveTradeDate: new Date("2026-06-15T10:00:00Z"),
      }),
    ];
    const evo = monthlyEvolution(trades);
    // 11-month span capped at 6 → last 6 months ending in June 2026.
    expect(evo).toHaveLength(6);
    expect(evo[evo.length - 1].month).toBe("2026-06");
  });

  test("returns an empty array when there are no trades", () => {
    expect(monthlyEvolution([])).toEqual([]);
  });
});

describe("tradingDnaSignals - quarterlyComparison", () => {
  test("returns null windows when either side is empty", () => {
    const comp = quarterlyComparison([], [makeTrade()]);
    expect(comp.current).toBeNull();
    expect(comp.previous).not.toBeNull();
    expect(comp.deltas).toBeNull();
  });

  test("computes deltas when both windows are populated", () => {
    const current = [makeTrade({ profit: 200 }), makeTrade({ profit: 100 })];
    const previous = [makeTrade({ profit: 50 }), makeTrade({ profit: -50 })];
    const comp = quarterlyComparison(current, previous);
    expect(comp.deltas.netPnL).toBe(300);
    expect(comp.deltas.winRate).toBeGreaterThanOrEqual(0);
  });
});

describe("tradingDnaSignals - behaviorPatterns", () => {
  test("emits plan-vs-emotion pattern when both groups have >= 5 trades", () => {
    const trades = [
      ...Array.from({ length: 5 }, () => makeTrade({ entryBasis: "Plan", profit: 100 })),
      ...Array.from({ length: 5 }, () => makeTrade({ entryBasis: "Emotion", profit: -100 })),
    ];
    const patterns = behaviorPatterns(trades);
    const pattern = patterns.find((p) => p.pattern.includes("Plan vs emotion"));
    expect(pattern).toBeDefined();
    expect(pattern.consequence).toMatch(/win rate/i);
  });

  test("skips patterns when subgroup is too small", () => {
    const trades = Array.from({ length: 3 }, () =>
      makeTrade({ entryBasis: "Plan" })
    );
    expect(behaviorPatterns(trades).length).toBe(0);
  });
});

describe("tradingDnaSignals - summarizeWindow", () => {
  test("returns null on empty input", () => {
    expect(summarizeWindow([])).toBeNull();
  });

  test("summarizes counts, win rate, and net P&L", () => {
    const trades = [makeTrade({ profit: 100 }), makeTrade({ profit: -50 })];
    const s = summarizeWindow(trades);
    expect(s.trades).toBe(2);
    expect(s.netPnL).toBe(50);
    expect(s.winRate).toBe(50);
  });
});

describe("tradingDnaSignals - buildPersonalityBundle", () => {
  test("flags lowSample when trade count under 20", () => {
    const period = {
      periodType: "90d",
      label: "Last 90 days",
      from: new Date("2026-01-01"),
      to: new Date("2026-04-01"),
    };
    const bundle = buildPersonalityBundle({
      trades: [makeTrade(), makeTrade()],
      previousTrades: [],
      marketLabel: "Forex",
      period,
      performance: { netPnL: 200, winRate: 100, profitFactor: 0, avgWin: 100, avgLoss: 0 },
      psychology: null,
    });
    expect(bundle.sample.lowSample).toBe(true);
    expect(bundle.sample.totalTrades).toBe(2);
    expect(bundle.marketType).toBe("Forex");
    expect(bundle.period).toBe("Last 90 days");
  });

  test("includes computed sub-sections", () => {
    const period = {
      periodType: "90d",
      label: "Last 90 days",
      from: new Date("2026-01-01"),
      to: new Date("2026-04-01"),
    };
    const trades = Array.from({ length: 25 }, (_, i) =>
      makeTrade({
        profit: i % 2 === 0 ? 100 : -50,
        effectiveTradeDate: dayOffset("2026-02-01", i),
      })
    );
    const bundle = buildPersonalityBundle({
      trades,
      previousTrades: [],
      marketLabel: "Indian_Market",
      period,
      performance: { netPnL: 1000, winRate: 60, profitFactor: 2, avgWin: 100, avgLoss: 50 },
      psychology: {
        psychologyScore: 75,
        scoreBreakdown: {
          planAdherencePct: 80,
          calmTradingPct: 60,
          noRevengePct: 95,
          wouldRetakePct: 70,
        },
        mood: { tracked: 25, average: 4.1 },
      },
    });
    expect(bundle.sample.lowSample).toBe(false);
    expect(bundle.marketType).toBe("Indian_Market");
    expect(bundle.setups).toBeDefined();
    expect(bundle.sessions).toBeDefined();
    expect(bundle.monthlyEvolution.length).toBeGreaterThan(0);
    expect(bundle.psychologySummary.score).toBe(75);
  });
});
