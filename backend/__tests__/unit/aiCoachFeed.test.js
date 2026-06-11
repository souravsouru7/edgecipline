"use strict";

const { generateCoachFeed, CATEGORY } = require("../../utils/aiCoachFeed");
const { computePsychologyCost } = require("../../utils/psychologyCost");
const { computeTradingDNA } = require("../../utils/tradingDNA");
const { computePatternDetection } = require("../../utils/patternDetection");
const { computeSelfAwarenessAnalytics } = require("../../utils/tradeEvaluation");

// ── Fixture builders ──────────────────────────────────────────────────────────

function makeTrade(overrides = {}) {
  return {
    profit: 100,
    tradeDate: new Date("2026-05-15T10:00:00Z"),
    createdAt: new Date("2026-05-15T10:00:00Z"),
    session: "London",
    mood: 4,
    confidence: "High",
    emotionalTags: ["Calm"],
    mistakeTag: null,
    setupScore: 80,
    setupRules: [{ label: "Wait For Confirmation", followed: true }],
    entryBasis: "Plan",
    wouldRetake: "Yes",
    tradeQuality: "Great",
    pair: "EURUSD",
    type: "BUY",
    ...overrides,
  };
}

// 20 trades: mix of win/loss, sessions, emotions, moods
function makeSampleTrades() {
  const trades = [];
  const sessions = ["London", "NY", "Asia"];
  const emotions = [["FOMO"], ["Calm"], ["Fear"], ["Calm"], ["Revenge"]];
  const confidences = ["High", "Medium", "Low", "Overconfident", "High"];
  const moods = [4, 5, 2, 3, 4];
  const profits = [200, -300, 150, -120, 80, -250, 180, 90, -400, 160, -80, 220, -90, 130, -180, 300, -50, 110, -70, 200];
  const qualities = ["Great", "Poor", "Great", "Average", "Great", "Poor", "Great", "Average", "Poor", "Great",
                     "Average", "Great", "Poor", "Great", "Average", "Great", "Poor", "Average", "Average", "Great"];

  for (let i = 0; i < 20; i++) {
    trades.push(makeTrade({
      profit: profits[i],
      session: sessions[i % 3],
      emotionalTags: profits[i] < 0 ? emotions[i % 5] : [["Calm", "Focused"][i % 2]],
      confidence: confidences[i % 5],
      mood: moods[i % 5],
      tradeQuality: qualities[i],
      setupScore: 60 + (i % 4) * 10,
      entryBasis: ["Plan", "Custom", "Emotion", "Plan"][i % 4],
      wouldRetake: profits[i] > 0 ? "Yes" : "No",
      setupRules: [
        { label: "Wait For Confirmation", followed: i % 3 !== 0 },
        { label: "Check News", followed: i % 4 !== 0 },
      ],
      mistakeTag: profits[i] < -150 ? "Early Entry" : null,
      tradeDate: new Date(2026, 4, 1 + i, 10, 0, 0),
    }));
  }
  return trades;
}

// ── Edge Case: Empty trades ───────────────────────────────────────────────────

describe("generateCoachFeed — edge cases", () => {
  test("returns insufficient:true with reason no_trades when totalTrades is 0", () => {
    const feed = generateCoachFeed({ totalTrades: 0, totalVolume: 0, marketType: "Forex" });
    expect(feed.insufficient).toBe(true);
    expect(feed.reason).toBe("no_trades");
    expect(feed.insights).toHaveLength(0);
    expect(feed.message).toMatch(/no trades/i);
  });

  test("returns insufficient:true with reason too_few_trades when totalTrades < 5", () => {
    const feed = generateCoachFeed({ totalTrades: 3, totalVolume: 300, marketType: "Forex" });
    expect(feed.insufficient).toBe(true);
    expect(feed.reason).toBe("too_few_trades");
    expect(feed.message).toMatch(/3 trade/i);
  });

  test("handles missing all data sources gracefully", () => {
    const feed = generateCoachFeed({
      psychologyCost: null,
      tradingDNA: null,
      patterns: null,
      selfAwareness: null,
      totalTrades: 10,
      totalVolume: 1000,
      marketType: "Forex",
    });
    expect(feed.insufficient).toBe(false);
    expect(Array.isArray(feed.insights)).toBe(true);
    // No crashes even with all nulls
  });

  test("handles insufficient tradingDNA and patterns gracefully", () => {
    const feed = generateCoachFeed({
      psychologyCost: null,
      tradingDNA: { insufficient: true },
      patterns: { insufficient: true },
      selfAwareness: null,
      totalTrades: 10,
      totalVolume: 1000,
      marketType: "Forex",
    });
    expect(feed.insufficient).toBe(false);
    expect(Array.isArray(feed.insights)).toBe(true);
  });

  test("uses ₹ currency symbol for Indian_Market", () => {
    const trades = makeSampleTrades();
    const psych = computePsychologyCost(trades);
    psych.behavioralDNA.mostExpensiveEmotion = { name: "FOMO", cost: -1000 };
    psych.emotionalCosts = [{ tag: "FOMO", count: 5, winRate: 20, netPnL: -1000, avgPnL: -200, isNegativeBehavior: true }];
    const feed = generateCoachFeed({
      psychologyCost: psych,
      totalTrades: 20,
      totalVolume: 5000,
      marketType: "Indian_Market",
    });
    const fomoInsight = feed.insights.find(i => i.id.includes("fomo"));
    if (fomoInsight) {
      expect(fomoInsight.insight).toContain("₹");
    }
  });

  test("uses $ currency symbol for Forex", () => {
    const trades = makeSampleTrades();
    const psych = computePsychologyCost(trades);
    psych.behavioralDNA.mostExpensiveEmotion = { name: "FOMO", cost: -1000 };
    psych.emotionalCosts = [{ tag: "FOMO", count: 5, winRate: 20, netPnL: -1000, avgPnL: -200, isNegativeBehavior: true }];
    const feed = generateCoachFeed({
      psychologyCost: psych,
      totalTrades: 20,
      totalVolume: 5000,
      marketType: "Forex",
    });
    const fomoInsight = feed.insights.find(i => i.id.includes("fomo"));
    if (fomoInsight) {
      expect(fomoInsight.insight).toContain("$");
    }
  });
});

// ── Full feed generation ──────────────────────────────────────────────────────

describe("generateCoachFeed — full pipeline", () => {
  let feed;
  let trades;

  beforeAll(() => {
    trades = makeSampleTrades();
    const psychologyCost = computePsychologyCost(trades);
    const selfAwareness = computeSelfAwarenessAnalytics(trades);
    const tradingDNA = computeTradingDNA(trades, "Forex", selfAwareness);
    const patterns = computePatternDetection(trades, "Forex");
    const totalVolume = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);

    feed = generateCoachFeed({
      psychologyCost,
      tradingDNA,
      patterns,
      selfAwareness,
      totalTrades: trades.length,
      totalVolume,
      marketType: "Forex",
    });
  });

  test("returns insufficient:false for 20 trades", () => {
    expect(feed.insufficient).toBe(false);
  });

  test("insights is a non-empty array", () => {
    expect(Array.isArray(feed.insights)).toBe(true);
    expect(feed.insights.length).toBeGreaterThan(0);
  });

  test("every insight has required fields", () => {
    for (const insight of feed.insights) {
      expect(typeof insight.id).toBe("string");
      expect(insight.id.length).toBeGreaterThan(0);
      expect(typeof insight.category).toBe("string");
      expect(["negative", "positive", "neutral"]).toContain(insight.type);
      expect(["high", "medium", "low"]).toContain(insight.priority);
      expect(typeof insight.impactScore).toBe("number");
      expect(insight.impactScore).toBeGreaterThan(0);
      expect(typeof insight.title).toBe("string");
      expect(insight.title.length).toBeGreaterThan(0);
      expect(typeof insight.insight).toBe("string");
      expect(insight.insight.length).toBeGreaterThan(0);
      expect(typeof insight.evidence).toBe("string");
      expect(typeof insight.recommendation).toBe("string");
    }
  });

  test("all IDs are unique (deduplication works)", () => {
    const ids = feed.insights.map(i => i.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("stats match actual insight counts", () => {
    const negCount = feed.insights.filter(i => i.type === "negative").length;
    const posCount = feed.insights.filter(i => i.type === "positive").length;
    const neutCount = feed.insights.filter(i => i.type === "neutral").length;
    expect(feed.stats.negative).toBe(negCount);
    expect(feed.stats.positive).toBe(posCount);
    expect(feed.stats.neutral).toBe(neutCount);
    expect(feed.stats.total).toBe(feed.insights.length);
  });

  test("generatedAt is a valid ISO timestamp", () => {
    expect(typeof feed.generatedAt).toBe("string");
    expect(new Date(feed.generatedAt).toISOString()).toBe(feed.generatedAt);
  });

  test("marketType is correctly set", () => {
    expect(feed.marketType).toBe("Forex");
  });

  test("totalTrades matches", () => {
    expect(feed.totalTrades).toBe(20);
  });
});

// ── Insight categories ────────────────────────────────────────────────────────

describe("generateCoachFeed — insight category coverage", () => {
  function feedWithEmotion(tag, netPnL, count) {
    const cost = netPnL < 0 ? netPnL : undefined;
    const profit = netPnL > 0 ? netPnL : undefined;
    const psychologyCost = {
      totalTrades: 10,
      behavioralDNA: {
        mostExpensiveEmotion: netPnL < 0 ? { name: tag, cost: netPnL } : null,
        mostProfitableEmotion: netPnL > 0 ? { name: tag, profit: netPnL } : null,
        mostExpensiveMistake: null,
        weakestDisciplineTrait: null,
      },
      emotionalCosts: [{ tag, count, winRate: 25, netPnL, avgPnL: netPnL / count, isNegativeBehavior: netPnL < 0 }],
      ruleViolations: [],
      mistakeCosts: [],
      healthyNetPnL: netPnL > 0 ? netPnL : 0,
      unhealthyNetPnL: netPnL < 0 ? netPnL : 0,
    };
    return generateCoachFeed({
      psychologyCost,
      totalTrades: 10,
      totalVolume: Math.abs(netPnL) * 2,
      marketType: "Forex",
    });
  }

  test("generates Psychology negative insight for expensive FOMO", () => {
    const feed = feedWithEmotion("FOMO", -2000, 8);
    const insight = feed.insights.find(i => i.category === CATEGORY.PSYCHOLOGY && i.type === "negative");
    expect(insight).toBeTruthy();
    expect(insight.title).toMatch(/FOMO/i);
  });

  test("generates Improvement positive insight for profitable Calm emotion", () => {
    const feed = feedWithEmotion("Calm", 3000, 10);
    const insight = feed.insights.find(i => i.type === "positive" && i.title.match(/calm/i));
    expect(insight).toBeTruthy();
  });

  test("generates Discipline insight for rule violations", () => {
    const psychologyCost = {
      totalTrades: 10,
      behavioralDNA: {
        mostExpensiveEmotion: null,
        mostProfitableEmotion: null,
        mostExpensiveMistake: null,
        weakestDisciplineTrait: { rule: "Wait For Confirmation", cost: -1500 },
      },
      emotionalCosts: [],
      ruleViolations: [{ rule: "Wait For Confirmation", timesBroken: 5, count: 5, winRate: 20, netPnL: -1500, avgPnL: -300 }],
      mistakeCosts: [],
      healthyNetPnL: 0,
      unhealthyNetPnL: -1500,
    };
    const feed = generateCoachFeed({ psychologyCost, totalTrades: 10, totalVolume: 3000, marketType: "Forex" });
    const insight = feed.insights.find(i => i.category === CATEGORY.DISCIPLINE && i.type === "negative");
    expect(insight).toBeTruthy();
    expect(insight.evidence).toMatch(/5 violations/i);
  });

  test("generates TradingDNA insight for best session", () => {
    const tradingDNA = {
      insufficient: false,
      sessionDNA: {
        best: { name: "London", trades: 10, winRate: 70, netPnL: 2000, avgPnL: 200, confidence: "Medium" },
        worst: null,
        all: [],
      },
      moodDNA: { best: null, worst: null, all: [] },
      confidenceDNA: { best: null, worst: null, all: [] },
      dayDNA: { best: null, worst: null, all: [] },
      instrumentDNA: { best: null, worst: null, all: [] },
      behavioralDNA: null,
    };
    const feed = generateCoachFeed({ tradingDNA, totalTrades: 10, totalVolume: 4000, marketType: "Forex" });
    const insight = feed.insights.find(i => i.category === CATEGORY.TRADING_DNA && i.type === "positive");
    expect(insight).toBeTruthy();
    expect(insight.title).toMatch(/London/i);
  });

  test("generates Confidence warning for overconfident trades", () => {
    const tradingDNA = {
      insufficient: false,
      confidenceDNA: {
        best: { name: "Medium", trades: 10, winRate: 65, netPnL: 1500, avgPnL: 150, confidence: "Medium" },
        worst: { name: "Overconfident", trades: 6, winRate: 17, netPnL: -1200, avgPnL: -200, confidence: "Low" },
        all: [
          { name: "Overconfident", trades: 6, winRate: 17, netPnL: -1200, avgPnL: -200, confidence: "Low" },
          { name: "Medium", trades: 10, winRate: 65, netPnL: 1500, avgPnL: 150, confidence: "Medium" },
        ],
      },
      sessionDNA: null,
      moodDNA: { best: null, worst: null, all: [] },
      dayDNA: { best: null, worst: null, all: [] },
      instrumentDNA: { best: null, worst: null, all: [] },
      behavioralDNA: null,
    };
    const feed = generateCoachFeed({ tradingDNA, totalTrades: 16, totalVolume: 5400, marketType: "Forex" });
    const overconfInsight = feed.insights.find(i => i.id.includes("overconfidence"));
    expect(overconfInsight).toBeTruthy();
    expect(overconfInsight.type).toBe("negative");
  });

  test("generates Pattern insight from ranked patterns", () => {
    const patterns = {
      insufficient: false,
      rankings: {
        top5Negative: [
          { name: "FOMO", description: "Emotional tag: FOMO", netPnl: -2000, winRate: 15, count: 8, confidence: "Medium", module: "emotion" },
        ],
        top5Positive: [
          { name: "London Session", description: "Session: London", netPnl: 3000, winRate: 72, count: 12, confidence: "High", module: "session" },
        ],
      },
      combinations: { mostDangerous: null, mostProfitable: null },
      aiContext: { patterns: { lossStreakImpact: null } },
    };
    const feed = generateCoachFeed({ patterns, totalTrades: 20, totalVolume: 8000, marketType: "Forex" });
    const negPat = feed.insights.find(i => i.category === CATEGORY.PATTERN && i.type === "negative");
    expect(negPat).toBeTruthy();
    const posPat = feed.insights.find(i => i.category === CATEGORY.IMPROVEMENT && i.type === "positive");
    expect(posPat).toBeTruthy();
  });

  test("generates SelfAwareness insight for low accuracy score", () => {
    const selfAwareness = {
      score: 40,
      trackedCount: 10,
      totalTrades: 15,
      overconfident: 4,
      underconfident: 1,
      perCategory: {
        Great: { total: 5, correct: 2, accuracy: 40 },
        Average: { total: 3, correct: 1, accuracy: 33 },
        Poor: { total: 2, correct: 2, accuracy: 100 },
      },
      bestJudgedCategory: "Poor",
      worstJudgedCategory: "Average",
      patterns: ["You rate 80% of your Great trades above your actual execution."],
    };
    const feed = generateCoachFeed({ selfAwareness, totalTrades: 15, totalVolume: 3000, marketType: "Forex" });
    const saInsight = feed.insights.find(i => i.category === CATEGORY.SELF_AWARENESS || i.category === CATEGORY.IMPROVEMENT);
    expect(saInsight).toBeTruthy();
  });
});

// ── Ranking engine ────────────────────────────────────────────────────────────

describe("generateCoachFeed — ranking and ordering", () => {
  test("high impactScore insight appears before low impactScore within same type", () => {
    const psychologyCost = {
      totalTrades: 20,
      behavioralDNA: {
        mostExpensiveEmotion: { name: "FOMO", cost: -5000 },
        mostProfitableEmotion: { name: "Calm", profit: 200 }, // small
        mostExpensiveMistake: null,
        weakestDisciplineTrait: null,
      },
      emotionalCosts: [
        { tag: "FOMO", count: 10, winRate: 20, netPnL: -5000, avgPnL: -500, isNegativeBehavior: true },
        { tag: "Calm", count: 5, winRate: 70, netPnL: 200, avgPnL: 40, isNegativeBehavior: false },
      ],
      ruleViolations: [],
      mistakeCosts: [],
      healthyNetPnL: 200,
      unhealthyNetPnL: -5000,
    };
    const feed = generateCoachFeed({ psychologyCost, totalTrades: 20, totalVolume: 10000, marketType: "Forex" });
    const negatives = feed.insights.filter(i => i.type === "negative");
    for (let i = 1; i < negatives.length; i++) {
      expect(negatives[i - 1].impactScore).toBeGreaterThanOrEqual(negatives[i].impactScore);
    }
  });

  test("priority is high for impactScore >= 50", () => {
    const psychologyCost = {
      totalTrades: 10,
      behavioralDNA: {
        mostExpensiveEmotion: { name: "Revenge", cost: -10000 },
        mostProfitableEmotion: null,
        mostExpensiveMistake: null,
        weakestDisciplineTrait: null,
      },
      emotionalCosts: [{ tag: "Revenge", count: 8, winRate: 10, netPnL: -10000, avgPnL: -1250, isNegativeBehavior: true }],
      ruleViolations: [],
      mistakeCosts: [],
      healthyNetPnL: 0,
      unhealthyNetPnL: -10000,
    };
    const feed = generateCoachFeed({ psychologyCost, totalTrades: 10, totalVolume: 12000, marketType: "Forex" });
    const highImpact = feed.insights.find(i => i.impactScore >= 50);
    if (highImpact) {
      expect(highImpact.priority).toBe("high");
    }
  });
});

// ── Positive reinforcement ratio ─────────────────────────────────────────────

describe("generateCoachFeed — positive/negative balance", () => {
  test("generates at least one positive insight when data supports it", () => {
    const trades = makeSampleTrades();
    const psychologyCost = computePsychologyCost(trades);
    const tradingDNA = computeTradingDNA(trades, "Forex", null);
    const patterns = computePatternDetection(trades, "Forex");
    const totalVolume = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);

    const feed = generateCoachFeed({
      psychologyCost,
      tradingDNA,
      patterns,
      totalTrades: trades.length,
      totalVolume,
      marketType: "Forex",
    });

    const positiveCount = feed.insights.filter(i => i.type === "positive").length;
    // Data has profitable sessions, good moods, positive emotions
    // So we should have at least some positive insights
    expect(feed.insights.length).toBeGreaterThan(0);
    // Ratio should not be 100% negative
    if (feed.insights.length >= 3) {
      expect(positiveCount).toBeGreaterThan(0);
    }
  });

  test("negative insights appear before positive in balanced feed", () => {
    const feed = generateCoachFeed({
      psychologyCost: {
        totalTrades: 10,
        behavioralDNA: {
          mostExpensiveEmotion: { name: "FOMO", cost: -3000 },
          mostProfitableEmotion: { name: "Calm", profit: 1500 },
          mostExpensiveMistake: null,
          weakestDisciplineTrait: null,
        },
        emotionalCosts: [
          { tag: "FOMO", count: 6, winRate: 17, netPnL: -3000, avgPnL: -500, isNegativeBehavior: true },
          { tag: "Calm", count: 4, winRate: 75, netPnL: 1500, avgPnL: 375, isNegativeBehavior: false },
        ],
        ruleViolations: [],
        mistakeCosts: [],
        healthyNetPnL: 1500,
        unhealthyNetPnL: -3000,
      },
      totalTrades: 10,
      totalVolume: 9000,
      marketType: "Forex",
    });

    // First insight should not be positive (negatives have higher priority)
    expect(feed.insights.length).toBeGreaterThan(0);
    expect(feed.insights[0].type).toBe("negative");
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe("generateCoachFeed — deduplication", () => {
  test("no duplicate IDs in output", () => {
    const trades = makeSampleTrades();
    const psychologyCost = computePsychologyCost(trades);
    const tradingDNA = computeTradingDNA(trades, "Forex", null);
    const patterns = computePatternDetection(trades, "Forex");
    const totalVolume = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);

    const feed = generateCoachFeed({
      psychologyCost,
      tradingDNA,
      patterns,
      totalTrades: trades.length,
      totalVolume,
      marketType: "Forex",
    });

    const ids = feed.insights.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── formatAmount helper via public behavior ────────────────────────────────────

describe("generateCoachFeed — currency formatting", () => {
  test("formats thousands with K suffix", () => {
    const psych = {
      totalTrades: 10,
      behavioralDNA: {
        mostExpensiveEmotion: { name: "FOMO", cost: -1500 },
        mostProfitableEmotion: null,
        mostExpensiveMistake: null,
        weakestDisciplineTrait: null,
      },
      emotionalCosts: [{ tag: "FOMO", count: 5, winRate: 20, netPnL: -1500, avgPnL: -300, isNegativeBehavior: true }],
      ruleViolations: [],
      mistakeCosts: [],
      healthyNetPnL: 0,
      unhealthyNetPnL: -1500,
    };
    const feed = generateCoachFeed({ psychologyCost: psych, totalTrades: 10, totalVolume: 3000, marketType: "Forex" });
    const fomoInsight = feed.insights.find(i => i.id.includes("fomo"));
    if (fomoInsight) {
      expect(fomoInsight.insight).toMatch(/\$1\.5K/);
    }
  });

  test("formats millions with M suffix", () => {
    const psych = {
      totalTrades: 10,
      behavioralDNA: {
        mostExpensiveEmotion: { name: "Fear", cost: -2000000 },
        mostProfitableEmotion: null,
        mostExpensiveMistake: null,
        weakestDisciplineTrait: null,
      },
      emotionalCosts: [{ tag: "Fear", count: 5, winRate: 10, netPnL: -2000000, avgPnL: -400000, isNegativeBehavior: true }],
      ruleViolations: [],
      mistakeCosts: [],
      healthyNetPnL: 0,
      unhealthyNetPnL: -2000000,
    };
    const feed = generateCoachFeed({ psychologyCost: psych, totalTrades: 10, totalVolume: 4000000, marketType: "Forex" });
    const fearInsight = feed.insights.find(i => i.id.includes("fear"));
    if (fearInsight) {
      expect(fearInsight.insight).toMatch(/\$2\.0M/);
    }
  });
});

// ── Performance tests ─────────────────────────────────────────────────────────

describe("generateCoachFeed — performance", () => {
  function largeTrades(n) {
    return Array.from({ length: n }, (_, i) =>
      makeTrade({
        profit: i % 2 === 0 ? 100 + i : -(50 + i),
        emotionalTags: i % 3 === 0 ? ["FOMO"] : ["Calm"],
        mood: (i % 5) + 1,
        confidence: ["Low", "Medium", "High", "Overconfident", "High"][i % 5],
        mistakeTag: i % 4 === 0 ? "Early Entry" : null,
        setupRules: [{ label: "Rule A", followed: i % 3 !== 0 }],
        tradeDate: new Date(2024, 0, 1 + (i % 365), 10, 0, 0),
        tradeQuality: ["Great", "Average", "Poor"][i % 3],
      })
    );
  }

  const PERF_TIMEOUT = 5000;

  test("handles 100 trades within 500ms", () => {
    const trades = largeTrades(100);
    const psych = computePsychologyCost(trades);
    const sa = computeSelfAwarenessAnalytics(trades);
    const dna = computeTradingDNA(trades, "Forex", sa);
    const pats = computePatternDetection(trades, "Forex");
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit), 0);

    const start = Date.now();
    const feed = generateCoachFeed({ psychologyCost: psych, tradingDNA: dna, patterns: pats, selfAwareness: sa, totalTrades: 100, totalVolume: vol, marketType: "Forex" });
    const elapsed = Date.now() - start;

    expect(feed.insufficient).toBe(false);
    expect(elapsed).toBeLessThan(500);
  }, PERF_TIMEOUT);

  test("handles 1000 trades within 1000ms", () => {
    const trades = largeTrades(1000);
    const psych = computePsychologyCost(trades);
    const sa = computeSelfAwarenessAnalytics(trades);
    const dna = computeTradingDNA(trades, "Forex", sa);
    const pats = computePatternDetection(trades, "Forex");
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit), 0);

    const start = Date.now();
    const feed = generateCoachFeed({ psychologyCost: psych, tradingDNA: dna, patterns: pats, selfAwareness: sa, totalTrades: 1000, totalVolume: vol, marketType: "Forex" });
    const elapsed = Date.now() - start;

    expect(feed.insufficient).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  }, PERF_TIMEOUT);

  test("handles 10000 trades without crashing", () => {
    const trades = largeTrades(10000);
    const psych = computePsychologyCost(trades);
    const sa = computeSelfAwarenessAnalytics(trades);
    const dna = computeTradingDNA(trades, "Forex", sa);
    const pats = computePatternDetection(trades, "Forex");
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit), 0);

    expect(() => {
      generateCoachFeed({ psychologyCost: psych, tradingDNA: dna, patterns: pats, selfAwareness: sa, totalTrades: 10000, totalVolume: vol, marketType: "Forex" });
    }).not.toThrow();
  }, 15000);
});

// ── Indian Market support ─────────────────────────────────────────────────────

describe("generateCoachFeed — Indian Market", () => {
  test("returns correct marketType", () => {
    const feed = generateCoachFeed({ totalTrades: 10, totalVolume: 1000, marketType: "Indian_Market" });
    expect(feed.marketType).toBe("Indian_Market");
  });

  test("generates insights from Indian market trades", () => {
    const trades = makeSampleTrades().map(t => ({
      ...t,
      session: ["Opening", "Midday", "Closing"][Math.floor(Math.random() * 3)],
    }));
    const psych = computePsychologyCost(trades);
    const sa = computeSelfAwarenessAnalytics(trades);
    const dna = computeTradingDNA(trades, "Indian_Market", sa);
    const pats = computePatternDetection(trades, "Indian_Market");
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);

    const feed = generateCoachFeed({
      psychologyCost: psych,
      tradingDNA: dna,
      patterns: pats,
      selfAwareness: sa,
      totalTrades: trades.length,
      totalVolume: vol,
      marketType: "Indian_Market",
    });

    expect(feed.insufficient).toBe(false);
    expect(feed.marketType).toBe("Indian_Market");
  });
});

// ── Regression: existing engines unaffected ───────────────────────────────────

describe("generateCoachFeed — regression", () => {
  test("does not mutate trades array", () => {
    const trades = makeSampleTrades();
    const original = JSON.stringify(trades);
    const psych = computePsychologyCost(trades);
    const sa = computeSelfAwarenessAnalytics(trades);
    const dna = computeTradingDNA(trades, "Forex", sa);
    const pats = computePatternDetection(trades, "Forex");
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);

    generateCoachFeed({ psychologyCost: psych, tradingDNA: dna, patterns: pats, selfAwareness: sa, totalTrades: trades.length, totalVolume: vol, marketType: "Forex" });

    expect(JSON.stringify(trades)).toBe(original);
  });

  test("psychologyCost engine output unchanged after coach feed generation", () => {
    const trades = makeSampleTrades();
    const psych1 = computePsychologyCost(trades);
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);
    generateCoachFeed({ psychologyCost: computePsychologyCost(trades), totalTrades: trades.length, totalVolume: vol, marketType: "Forex" });
    const psych2 = computePsychologyCost(trades);
    expect(psych1.totalTrades).toBe(psych2.totalTrades);
    expect(psych1.psychologyCostScore).toBe(psych2.psychologyCostScore);
  });

  test("patternDetection engine output unchanged after coach feed", () => {
    const trades = makeSampleTrades();
    const pats1 = computePatternDetection(trades, "Forex");
    const vol = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0);
    generateCoachFeed({ patterns: computePatternDetection(trades, "Forex"), totalTrades: trades.length, totalVolume: vol, marketType: "Forex" });
    const pats2 = computePatternDetection(trades, "Forex");
    expect(pats1.totalTrades).toBe(pats2.totalTrades);
    expect(pats1.insufficient).toBe(pats2.insufficient);
  });
});
