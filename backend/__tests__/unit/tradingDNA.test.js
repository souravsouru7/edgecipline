
/**
 * Trading DNA Engine — Unit Tests
 *
 * Covers:
 *  - getConfidence (Module 10)
 *  - Session DNA (Module 1 — Forex)
 *  - Pair DNA (Module 1 — Forex)
 *  - Indian Instrument DNA (Module 2)
 *  - Indian Style DNA (Module 2)
 *  - Day DNA (both markets)
 *  - Mood DNA (Module 3)
 *  - Confidence DNA (Module 3)
 *  - Emotion DNA (Module 3)
 *  - Mistake DNA (Module 3)
 *  - Discipline DNA — setup score ranges (Module 4)
 *  - Discipline DNA — rule adherence (Module 4)
 *  - Self-Awareness DNA (Module 5)
 *  - Behavioral Pattern DNA (Module 6)
 *  - DNA Summary / Identity (Module 7)
 *  - computeTradingDNA — integration
 *  - Edge cases: no trades, 1 trade, <5 trades, no psychology data, deleted trades, etc.
 *  - Tied results — deterministic tie-breaking
 *  - Performance: 100 / 1000 / 10000 / 50000 trades
 */

const { computeTradingDNA, getConfidence } = require("../../utils/tradingDNA");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTrade(overrides = {}) {
  return {
    profit: 100,
    session: "London",
    pair: "EURUSD",
    tradeDate: new Date("2024-03-04T10:00:00Z"), // Monday
    mood: 4,
    confidence: "Medium",
    emotionalTags: ["Calm"],
    mistakeTag: null,
    setupScore: 80,
    setupRules: [{ label: "Trend Confirmed", followed: true }],
    entryBasis: "Plan",
    wouldRetake: "Yes",
    tradeQuality: "Great",
    segment: "EQUITY",
    tradeType: "INTRADAY",
    optionType: null,
    createdAt: new Date("2024-03-04T10:00:00Z"),
    ...overrides,
  };
}

// Build N trades with given overrides
function makeTrades(n, overrides = {}) {
  return Array.from({ length: n }, () => makeTrade(overrides));
}

// Build trades split between two configurations
function splitTrades(nA, aOverrides, nB, bOverrides) {
  return [...makeTrades(nA, aOverrides), ...makeTrades(nB, bOverrides)];
}

// ── Module 10: getConfidence ──────────────────────────────────────────────────

describe("getConfidence", () => {
  test("null for 0 trades", () => expect(getConfidence(0)).toBeNull());
  test("null for 1 trade",  () => expect(getConfidence(1)).toBeNull());
  test("null for 4 trades", () => expect(getConfidence(4)).toBeNull());
  test("Low for 5 trades",  () => expect(getConfidence(5)).toBe("Low"));
  test("Low for 9 trades",  () => expect(getConfidence(9)).toBe("Low"));
  test("Medium for 10",     () => expect(getConfidence(10)).toBe("Medium"));
  test("Medium for 29",     () => expect(getConfidence(29)).toBe("Medium"));
  test("High for 30",       () => expect(getConfidence(30)).toBe("High"));
  test("High for 1000",     () => expect(getConfidence(1000)).toBe("High"));
  test("null for undefined",() => expect(getConfidence(undefined)).toBeNull());
  test("null for null",     () => expect(getConfidence(null)).toBeNull());
});

// ── Edge cases: empty / insufficient data ─────────────────────────────────────

describe("insufficient data", () => {
  test("empty array returns insufficient=true", () => {
    const dna = computeTradingDNA([], "Forex");
    expect(dna.insufficient).toBe(true);
    expect(dna.totalTrades).toBe(0);
    expect(dna.dnaSummary).toBeNull();
  });

  test("1 trade returns insufficient=true", () => {
    const dna = computeTradingDNA([makeTrade()], "Forex");
    expect(dna.insufficient).toBe(true);
  });

  test("4 trades returns insufficient=true", () => {
    const dna = computeTradingDNA(makeTrades(4), "Forex");
    expect(dna.insufficient).toBe(true);
  });

  test("5 trades returns insufficient=false", () => {
    const dna = computeTradingDNA(makeTrades(5), "Forex");
    expect(dna.insufficient).toBe(false);
    expect(dna.totalTrades).toBe(5);
  });

  test("null input returns insufficient=true", () => {
    const dna = computeTradingDNA(null, "Forex");
    expect(dna.insufficient).toBe(true);
    expect(dna.totalTrades).toBe(0);
  });
});

// ── Module 1: Session DNA (Forex) ─────────────────────────────────────────────

describe("sessionDNA — Forex", () => {
  test("best session has highest netPnL", () => {
    const trades = [
      ...makeTrades(5, { session: "London", profit: 200 }),
      ...makeTrades(5, { session: "New York", profit: 50 }),
    ];
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    expect(sessionDNA.best.name).toBe("London");
    expect(sessionDNA.worst.name).toBe("New York");
  });

  test("null when no session tags", () => {
    const trades = makeTrades(5, { session: null });
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    expect(sessionDNA.best).toBeNull();
    expect(sessionDNA.worst).toBeNull();
    expect(sessionDNA.all).toHaveLength(0);
  });

  test("worst is null when only one session exists", () => {
    const trades = makeTrades(5, { session: "London" });
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    expect(sessionDNA.best.name).toBe("London");
    expect(sessionDNA.worst).toBeNull();
  });

  test("sessionDNA is null for Indian_Market", () => {
    const { sessionDNA } = computeTradingDNA(makeTrades(5), "Indian_Market");
    expect(sessionDNA).toBeNull();
  });

  test("sessions with < 5 trades are excluded", () => {
    const trades = [
      ...makeTrades(5, { session: "London" }),
      ...makeTrades(3, { session: "Asia" }),     // only 3 → excluded
    ];
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    expect(sessionDNA.all.map((s) => s.name)).not.toContain("Asia");
  });

  test("winRate computed correctly", () => {
    const trades = [
      ...makeTrades(4, { session: "London", profit: 100 }),
      makeTrade({ session: "London", profit: -50 }),
    ];
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    const london = sessionDNA.all.find((s) => s.name === "London");
    expect(london.winRate).toBe(80.0);
    expect(london.trades).toBe(5);
  });
});

// ── Module 1: Pair DNA ────────────────────────────────────────────────────────

describe("instrumentDNA — Forex (pair)", () => {
  test("best pair is highest netPnL", () => {
    const trades = [
      ...makeTrades(5, { pair: "EURUSD", profit: 300 }),
      ...makeTrades(5, { pair: "GBPUSD", profit: -20 }),
    ];
    const { instrumentDNA } = computeTradingDNA(trades, "Forex");
    expect(instrumentDNA.best.name).toBe("EURUSD");
    expect(instrumentDNA.worst.name).toBe("GBPUSD");
  });

  test("pairs with < 5 trades are excluded", () => {
    const trades = [
      ...makeTrades(5, { pair: "EURUSD" }),
      ...makeTrades(2, { pair: "USDJPY" }),
    ];
    const { instrumentDNA } = computeTradingDNA(trades, "Forex");
    expect(instrumentDNA.all.some((p) => p.name === "USDJPY")).toBe(false);
  });
});

// ── Module 2: Indian Instrument DNA ──────────────────────────────────────────

describe("instrumentDNA — Indian_Market", () => {
  test("Equity vs Options Buying", () => {
    const trades = [
      ...makeTrades(5, { segment: "EQUITY", profit: 500, optionType: null }),
      ...makeTrades(5, { segment: "F&O", profit: -100, optionType: "CE" }),
    ];
    const { instrumentDNA } = computeTradingDNA(trades, "Indian_Market");
    expect(instrumentDNA.best.name).toBe("Equity");
    expect(instrumentDNA.worst.name).toBe("Options Buying");
  });

  test("Options Selling derived from PE", () => {
    const trades = makeTrades(5, { segment: "F&O", optionType: "PE" });
    const { instrumentDNA } = computeTradingDNA(trades, "Indian_Market");
    expect(instrumentDNA.all[0].name).toBe("Options Selling");
  });

  test("Futures when F&O without optionType", () => {
    const trades = makeTrades(5, { segment: "F&O", optionType: null });
    const { instrumentDNA } = computeTradingDNA(trades, "Indian_Market");
    expect(instrumentDNA.all[0].name).toBe("Futures");
  });
});

// ── Module 2: Indian Style DNA ────────────────────────────────────────────────

describe("styleDNA — Indian_Market", () => {
  test("INTRADAY vs SWING", () => {
    const trades = [
      ...makeTrades(5, { tradeType: "INTRADAY", profit: 200 }),
      ...makeTrades(5, { tradeType: "SWING",    profit: -50 }),
    ];
    const { styleDNA } = computeTradingDNA(trades, "Indian_Market");
    expect(styleDNA.best.name).toBe("INTRADAY");
    expect(styleDNA.worst.name).toBe("SWING");
  });

  test("styleDNA is null for Forex", () => {
    const { styleDNA } = computeTradingDNA(makeTrades(5), "Forex");
    expect(styleDNA).toBeNull();
  });
});

// ── Day DNA ───────────────────────────────────────────────────────────────────

describe("dayDNA", () => {
  test("best and worst day identified", () => {
    const monday = new Date("2024-03-04T10:00:00Z"); // Monday
    const friday = new Date("2024-03-08T10:00:00Z"); // Friday
    const trades = [
      ...Array.from({ length: 5 }, () => makeTrade({ tradeDate: monday, profit: 200 })),
      ...Array.from({ length: 5 }, () => makeTrade({ tradeDate: friday, profit: -50 })),
    ];
    const { dayDNA } = computeTradingDNA(trades, "Forex");
    expect(dayDNA.best.name).toBe("Monday");
    expect(dayDNA.worst.name).toBe("Friday");
  });

  test("invalid dates are skipped gracefully", () => {
    const trades = [
      ...makeTrades(5, { tradeDate: null, createdAt: new Date("2024-03-04T10:00:00Z") }),
    ];
    const { dayDNA } = computeTradingDNA(trades, "Forex");
    expect(dayDNA.all.length).toBeGreaterThanOrEqual(0); // no crash
  });
});

// ── Module 3: Mood DNA ────────────────────────────────────────────────────────

describe("moodDNA", () => {
  test("best mood is highest netPnL", () => {
    const trades = [
      ...makeTrades(5, { mood: 5, profit: 300 }),
      ...makeTrades(5, { mood: 1, profit: -100 }),
    ];
    const { moodDNA } = computeTradingDNA(trades, "Forex");
    expect(moodDNA.best.mood).toBe(5);
    expect(moodDNA.worst.mood).toBe(1);
  });

  test("null when no mood data", () => {
    const trades = makeTrades(5, { mood: null });
    const { moodDNA } = computeTradingDNA(trades, "Forex");
    expect(moodDNA.best).toBeNull();
    expect(moodDNA.worst).toBeNull();
  });

  test("out-of-range mood values are ignored", () => {
    const trades = [
      ...makeTrades(5, { mood: 0 }),
      ...makeTrades(5, { mood: 6 }),
    ];
    const { moodDNA } = computeTradingDNA(trades, "Forex");
    expect(moodDNA.all).toHaveLength(0);
  });
});

// ── Module 3: Confidence DNA ──────────────────────────────────────────────────

describe("confidenceDNA", () => {
  test("best confidence has highest netPnL", () => {
    const trades = [
      ...makeTrades(5, { confidence: "Medium", profit: 200 }),
      ...makeTrades(5, { confidence: "Overconfident", profit: -80 }),
    ];
    const { confidenceDNA } = computeTradingDNA(trades, "Forex");
    expect(confidenceDNA.best.name).toBe("Medium");
    expect(confidenceDNA.worst.name).toBe("Overconfident");
  });

  test("invalid confidence levels ignored", () => {
    const trades = makeTrades(5, { confidence: "VeryHigh" });
    const { confidenceDNA } = computeTradingDNA(trades, "Forex");
    expect(confidenceDNA.all).toHaveLength(0);
  });

  test("Low and High both included", () => {
    const trades = [
      ...makeTrades(5, { confidence: "Low",  profit: 50 }),
      ...makeTrades(5, { confidence: "High", profit: 100 }),
    ];
    const { confidenceDNA } = computeTradingDNA(trades, "Forex");
    const names = confidenceDNA.all.map((c) => c.name);
    expect(names).toContain("Low");
    expect(names).toContain("High");
  });
});

// ── Module 3: Emotion DNA ─────────────────────────────────────────────────────

describe("emotionDNA", () => {
  test("mostProfitable and mostExpensive correctly identified", () => {
    const trades = [
      ...makeTrades(5, { emotionalTags: ["Calm"],    profit: 200 }),
      ...makeTrades(5, { emotionalTags: ["FOMO"],    profit: -100 }),
      ...makeTrades(5, { emotionalTags: ["Focused"], profit: 50 }),
    ];
    const { emotionDNA } = computeTradingDNA(trades, "Forex");
    expect(emotionDNA.mostProfitable.name).toBe("Calm");
    expect(emotionDNA.mostExpensive.name).toBe("FOMO");
  });

  test("multi-tag trade attributes to each tag independently", () => {
    const trades = makeTrades(5, { emotionalTags: ["Calm", "FOMO"], profit: -50 });
    const { emotionDNA } = computeTradingDNA(trades, "Forex");
    const names = emotionDNA.all.map((e) => e.name);
    expect(names).toContain("Calm");
    expect(names).toContain("FOMO");
  });

  test("mostProfitable is null if no tag has positive netPnL", () => {
    const trades = makeTrades(5, { emotionalTags: ["FOMO"], profit: -30 });
    const { emotionDNA } = computeTradingDNA(trades, "Forex");
    expect(emotionDNA.mostProfitable).toBeNull();
  });

  test("mostExpensive is null if no tag has negative netPnL", () => {
    const trades = makeTrades(5, { emotionalTags: ["Calm"], profit: 100 });
    const { emotionDNA } = computeTradingDNA(trades, "Forex");
    expect(emotionDNA.mostExpensive).toBeNull();
  });

  test("null/empty emotionalTags are skipped", () => {
    const trades = makeTrades(5, { emotionalTags: [] });
    const { emotionDNA } = computeTradingDNA(trades, "Forex");
    expect(emotionDNA.all).toHaveLength(0);
  });
});

// ── Module 3: Mistake DNA ─────────────────────────────────────────────────────

describe("mistakeDNA", () => {
  test("mostExpensive is the tag with worst netPnL", () => {
    const trades = [
      ...makeTrades(5, { mistakeTag: "FOMO Entry",   profit: -200 }),
      ...makeTrades(5, { mistakeTag: "Early Exit",   profit: -50 }),
    ];
    const { mistakeDNA } = computeTradingDNA(trades, "Forex");
    expect(mistakeDNA.mostExpensive.name).toBe("FOMO Entry");
  });

  test("null mostExpensive if no tag has negative netPnL", () => {
    const trades = makeTrades(5, { mistakeTag: "Position Size", profit: 100 });
    const { mistakeDNA } = computeTradingDNA(trades, "Forex");
    expect(mistakeDNA.mostExpensive).toBeNull();
  });

  test("null/empty mistakeTags skipped", () => {
    const trades = makeTrades(5, { mistakeTag: null });
    const { mistakeDNA } = computeTradingDNA(trades, "Forex");
    expect(mistakeDNA.all).toHaveLength(0);
  });
});

// ── Module 4: Discipline DNA — setup score ranges ─────────────────────────────

describe("disciplineDNA — setup score ranges", () => {
  test("80–100 (Strong) range identified as best", () => {
    const trades = [
      ...makeTrades(5, { setupScore: 90, profit: 300 }),
      ...makeTrades(5, { setupScore: 30, profit: -100 }),
    ];
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.bestSetupRange.name).toBe("80–100 (Strong)");
    expect(disciplineDNA.worstSetupRange.name).toBe("0–39 (Poor)");
  });

  test("avgSetupScore computed correctly", () => {
    const trades = makeTrades(5, { setupScore: 80 });
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.avgSetupScore).toBe(80.0);
  });

  test("avgSetupScore null when no scores present", () => {
    const trades = makeTrades(5, { setupScore: null });
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.avgSetupScore).toBeNull();
  });

  test("ranges with < 5 trades are excluded", () => {
    const trades = [
      ...makeTrades(5, { setupScore: 85 }),
      ...makeTrades(3, { setupScore: 25 }),
    ];
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    const names = disciplineDNA.allSetupRanges.map((r) => r.name);
    expect(names).not.toContain("0–39 (Poor)");
  });
});

// ── Module 4: Discipline DNA — rule adherence ─────────────────────────────────

describe("disciplineDNA — rule adherence", () => {
  test("strongest rule has highest follow rate", () => {
    const rule1 = { label: "Trend Confirmed", followed: true };
    const rule2 = { label: "News Filter",     followed: false };
    const trades = [
      ...makeTrades(5, { setupRules: [rule1, rule2] }),
    ];
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.strongestRule.name).toBe("Trend Confirmed");
    expect(disciplineDNA.weakestRule.name).toBe("News Filter");
  });

  test("rules with < 5 total appearances are excluded", () => {
    const trades = [
      ...makeTrades(3, { setupRules: [{ label: "RareRule", followed: true }] }),
      ...makeTrades(5, { setupRules: [{ label: "CommonRule", followed: true }] }),
    ];
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    const names = disciplineDNA.allRules.map((r) => r.name);
    expect(names).not.toContain("RareRule");
    expect(names).toContain("CommonRule");
  });

  test("avgDisciplineScore is 100 when all rules followed", () => {
    const trades = makeTrades(5, { setupRules: [{ label: "Rule1", followed: true }] });
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.avgDisciplineScore).toBe(100.0);
  });

  test("avgDisciplineScore is 0 when all rules broken", () => {
    const trades = makeTrades(5, { setupRules: [{ label: "Rule1", followed: false }] });
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.avgDisciplineScore).toBe(0.0);
  });

  test("avgDisciplineScore null when no setupRules present", () => {
    const trades = makeTrades(5, { setupRules: [] });
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.avgDisciplineScore).toBeNull();
  });
});

// ── Module 5: Self-Awareness DNA ──────────────────────────────────────────────

describe("selfAwarenessDNA", () => {
  test("null when selfAwarenessResult has < 5 tracked trades", () => {
    const { selfAwarenessDNA } = computeTradingDNA(makeTrades(5), "Forex", {
      score: 80, trackedCount: 3
    });
    expect(selfAwarenessDNA).toBeNull();
  });

  test("profile set to Highly Self-Aware for score >= 80", () => {
    const { selfAwarenessDNA } = computeTradingDNA(makeTrades(5), "Forex", {
      score: 85, trackedCount: 10, bestJudgedCategory: "Great", worstJudgedCategory: "Poor",
      overconfident: 0, underconfident: 0, perCategory: {}, breakdown: [],
    });
    expect(selfAwarenessDNA.profile).toBe("Highly Self-Aware");
    expect(selfAwarenessDNA.confidence).toBe("Medium");
  });

  test("Overconfidence Bias detected when overconfident >= 3 and enough Great trades", () => {
    const { selfAwarenessDNA } = computeTradingDNA(makeTrades(5), "Forex", {
      score: 40, trackedCount: 20, overconfident: 5, underconfident: 0,
      perCategory: { Great: { total: 8, correct: 3, accuracy: 37 }, Average: { total: 8, correct: 6, accuracy: 75 }, Poor: { total: 4, correct: 4, accuracy: 100 } },
      breakdown: [],
    });
    const biasTypes = selfAwarenessDNA.biases.map((b) => b.type);
    expect(biasTypes).toContain("Overconfidence Bias");
  });

  test("Outcome Bias detected when breakdown has 5+ qualifying trades", () => {
    const breakdown = [
      { selfRating: "Great", systemTier: "Poor", pnl: 200 },
      { selfRating: "Great", systemTier: "Poor", pnl: 150 },
      { selfRating: "Great", systemTier: "Poor", pnl: 180 },
      { selfRating: "Great", systemTier: "Poor", pnl: 120 },
      { selfRating: "Great", systemTier: "Poor", pnl: 90 },
    ];
    const { selfAwarenessDNA } = computeTradingDNA(makeTrades(5), "Forex", {
      score: 50, trackedCount: 10, overconfident: 0, underconfident: 0,
      perCategory: { Great: { total: 5, correct: 3 }, Average: { total: 3, correct: 2 }, Poor: { total: 2, correct: 2 } },
      breakdown,
    });
    const biasTypes = selfAwarenessDNA.biases.map((b) => b.type);
    expect(biasTypes).toContain("Outcome Bias");
  });
});

// ── Module 6: Behavioral Pattern DNA ─────────────────────────────────────────

describe("behavioralDNA", () => {
  test("winningPattern has highest win rate", () => {
    const trades = [
      ...makeTrades(5, { emotionalTags: ["Calm"], confidence: "Medium", profit: 100 }),
      ...makeTrades(5, { emotionalTags: ["FOMO"], confidence: "High",   profit: -50 }),
    ];
    const { behavioralDNA } = computeTradingDNA(trades, "Forex");
    expect(behavioralDNA.winningPattern.conditionLabel).toContain("Calm");
    expect(behavioralDNA.winningPattern.winRate).toBe(100);
  });

  test("losingPattern has lowest win rate", () => {
    const trades = [
      ...makeTrades(5, { emotionalTags: ["Calm"], confidence: "Medium", profit: 100 }),
      ...makeTrades(5, { emotionalTags: ["FOMO"], confidence: "High",   profit: -50 }),
    ];
    const { behavioralDNA } = computeTradingDNA(trades, "Forex");
    expect(behavioralDNA.losingPattern.conditionLabel).toContain("FOMO");
    expect(behavioralDNA.losingPattern.winRate).toBe(0);
  });

  test("mostDangerousCombination is null if all combos profitable", () => {
    const trades = makeTrades(5, { emotionalTags: ["Calm"], confidence: "Medium", profit: 100 });
    const { behavioralDNA } = computeTradingDNA(trades, "Forex");
    expect(behavioralDNA.mostDangerousCombination).toBeNull();
  });

  test("null patterns when no combo reaches 5 trades", () => {
    const trades = [
      ...makeTrades(2, { emotionalTags: ["Calm"],    confidence: "Low",  profit: 100 }),
      ...makeTrades(2, { emotionalTags: ["FOMO"],    confidence: "High", profit: -50 }),
      ...makeTrades(1, { emotionalTags: ["Revenge"], confidence: "Low",  profit: -80 }),
    ];
    const { behavioralDNA } = computeTradingDNA(trades, "Forex");
    expect(behavioralDNA.winningPattern).toBeNull();
  });
});

// ── Module 7: DNA Summary ─────────────────────────────────────────────────────

describe("dnaSummary", () => {
  test("tradingIdentity is generated with 5+ trades", () => {
    const { dnaSummary } = computeTradingDNA(makeTrades(5), "Forex");
    expect(dnaSummary).not.toBeNull();
    expect(typeof dnaSummary.tradingIdentity).toBe("string");
    expect(dnaSummary.tradingIdentity.length).toBeGreaterThan(10);
  });

  test("dataConfidence is Low for exactly 5 trades", () => {
    const { dnaSummary } = computeTradingDNA(makeTrades(5), "Forex");
    expect(dnaSummary.dataConfidence).toBe("Low");
  });

  test("dataConfidence is High for 30+ trades", () => {
    const { dnaSummary } = computeTradingDNA(makeTrades(30), "Forex");
    expect(dnaSummary.dataConfidence).toBe("High");
  });

  test("keyStrengths and keyWeaknesses are arrays", () => {
    const { dnaSummary } = computeTradingDNA(makeTrades(10), "Forex");
    expect(Array.isArray(dnaSummary.keyStrengths)).toBe(true);
    expect(Array.isArray(dnaSummary.keyWeaknesses)).toBe(true);
  });
});

// ── Tied results — deterministic tie-breaking ─────────────────────────────────

describe("tie-breaking", () => {
  test("alphabetically earlier name wins when netPnL is tied", () => {
    const trades = [
      ...makeTrades(5, { session: "Asia",   profit: 100 }),
      ...makeTrades(5, { session: "London", profit: 100 }),
    ];
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    // "Asia" < "London" alphabetically → Asia is best when tied
    expect(sessionDNA.best.name).toBe("Asia");
    expect(sessionDNA.worst.name).toBe("London");
  });

  test("multiple sessions with identical P&L still produce deterministic results", () => {
    const trades = [
      ...makeTrades(5, { session: "Z-Session", profit: 50 }),
      ...makeTrades(5, { session: "A-Session", profit: 50 }),
      ...makeTrades(5, { session: "M-Session", profit: 50 }),
    ];
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    expect(sessionDNA.best.name).toBe("A-Session");
    expect(sessionDNA.worst.name).toBe("Z-Session");
  });
});

// ── Edge cases: no psychology data ───────────────────────────────────────────

describe("missing psychology data", () => {
  test("no mood data → moodDNA returns nulls", () => {
    const trades = makeTrades(5, { mood: undefined });
    const { moodDNA } = computeTradingDNA(trades, "Forex");
    expect(moodDNA.best).toBeNull();
    expect(moodDNA.worst).toBeNull();
  });

  test("no confidence → confidenceDNA returns nulls", () => {
    const trades = makeTrades(5, { confidence: undefined });
    const { confidenceDNA } = computeTradingDNA(trades, "Forex");
    expect(confidenceDNA.best).toBeNull();
  });

  test("no emotionalTags → emotionDNA all is empty", () => {
    const trades = makeTrades(5, { emotionalTags: undefined });
    const { emotionDNA } = computeTradingDNA(trades, "Forex");
    expect(emotionDNA.all).toHaveLength(0);
  });

  test("no setupRules → disciplineDNA rules is empty", () => {
    const trades = makeTrades(5, { setupRules: undefined });
    const { disciplineDNA } = computeTradingDNA(trades, "Forex");
    expect(disciplineDNA.allRules).toHaveLength(0);
    expect(disciplineDNA.avgDisciplineScore).toBeNull();
  });

  test("null profit treated as 0", () => {
    const trades = makeTrades(5, { profit: null, session: "London" });
    const { sessionDNA } = computeTradingDNA(trades, "Forex");
    expect(sessionDNA.best.netPnL).toBe(0);
  });
});

// ── Indian Market — combined test ─────────────────────────────────────────────

describe("computeTradingDNA — Indian_Market integration", () => {
  test("produces correct marketType", () => {
    const dna = computeTradingDNA(makeTrades(5), "Indian_Market");
    expect(dna.marketType).toBe("Indian_Market");
    expect(dna.sessionDNA).toBeNull();
    expect(dna.styleDNA).not.toBeNull();
  });

  test("instrument and style DNA computed", () => {
    const trades = [
      ...makeTrades(5, { segment: "EQUITY", tradeType: "INTRADAY", profit: 200 }),
      ...makeTrades(5, { segment: "F&O",    tradeType: "SWING",    optionType: "CE", profit: -50 }),
    ];
    const { instrumentDNA, styleDNA } = computeTradingDNA(trades, "Indian_Market");
    expect(instrumentDNA.best.name).toBe("Equity");
    expect(styleDNA.best.name).toBe("INTRADAY");
  });
});

// ── Performance tests ─────────────────────────────────────────────────────────

describe("performance", () => {
  const generateLarge = (n) =>
    Array.from({ length: n }, (_, i) => makeTrade({
      profit:        (i % 3 === 0) ? -100 : 150,
      session:       ["London", "New York", "Asia"][i % 3],
      pair:          ["EURUSD", "GBPUSD", "XAUUSD"][i % 3],
      mood:          (i % 5) + 1,
      confidence:    ["Low", "Medium", "High", "Overconfident"][i % 4],
      emotionalTags: [["Calm", "FOMO", "Focused", "Greed", "Revenge"][i % 5]],
      mistakeTag:    i % 4 === 0 ? ["FOMO Entry", "Early Exit", "Oversized"][i % 3] : null,
      setupScore:    (i % 100) + 1,
      setupRules:    [
        { label: ["Trend", "News", "Pullback"][i % 3], followed: i % 2 === 0 },
      ],
      tradeDate: new Date(Date.now() - i * 60000),
    }));

  test("100 trades complete under 100ms", () => {
    const trades = generateLarge(100);
    const t0 = Date.now();
    computeTradingDNA(trades, "Forex");
    expect(Date.now() - t0).toBeLessThan(100);
  });

  test("1000 trades complete under 200ms", () => {
    const trades = generateLarge(1000);
    const t0 = Date.now();
    computeTradingDNA(trades, "Forex");
    expect(Date.now() - t0).toBeLessThan(200);
  });

  test("10000 trades complete under 1000ms", () => {
    const trades = generateLarge(10000);
    const t0 = Date.now();
    computeTradingDNA(trades, "Forex");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("50000 trades complete under 3000ms", () => {
    const trades = generateLarge(50000);
    const t0 = Date.now();
    computeTradingDNA(trades, "Forex");
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test("10000 trades produce correct structure", () => {
    const trades = generateLarge(10000);
    const dna = computeTradingDNA(trades, "Forex");
    expect(dna.insufficient).toBe(false);
    expect(dna.totalTrades).toBe(10000);
    expect(dna.sessionDNA.best).not.toBeNull();
    expect(dna.dnaSummary.dataConfidence).toBe("High");
  });
});

// ── Full integration test ─────────────────────────────────────────────────────

describe("computeTradingDNA — full integration", () => {
  test("returns all module keys for Forex", () => {
    const dna = computeTradingDNA(makeTrades(10), "Forex");
    expect(dna).toHaveProperty("sessionDNA");
    expect(dna).toHaveProperty("instrumentDNA");
    expect(dna).toHaveProperty("styleDNA");
    expect(dna).toHaveProperty("dayDNA");
    expect(dna).toHaveProperty("moodDNA");
    expect(dna).toHaveProperty("confidenceDNA");
    expect(dna).toHaveProperty("emotionDNA");
    expect(dna).toHaveProperty("mistakeDNA");
    expect(dna).toHaveProperty("disciplineDNA");
    expect(dna).toHaveProperty("selfAwarenessDNA");
    expect(dna).toHaveProperty("behavioralDNA");
    expect(dna).toHaveProperty("dnaSummary");
    expect(dna).toHaveProperty("totalTrades");
    expect(dna).toHaveProperty("marketType");
    expect(dna).toHaveProperty("insufficient");
  });

  test("Forex users get session + pair DNA, not instrument/style", () => {
    const dna = computeTradingDNA(makeTrades(10), "Forex");
    expect(dna.styleDNA).toBeNull();
    // sessionDNA and instrumentDNA exist (may be empty but not null)
    expect(dna.sessionDNA).not.toBeNull();
    expect(dna.instrumentDNA).not.toBeNull();
  });

  test("Indian users get instrument + style DNA, not session", () => {
    const dna = computeTradingDNA(makeTrades(10), "Indian_Market");
    expect(dna.sessionDNA).toBeNull();
    expect(dna.instrumentDNA).not.toBeNull();
    expect(dna.styleDNA).not.toBeNull();
  });
});
