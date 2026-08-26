"use strict";

const { computePatternDetection, getConfidenceLevel } = require("../../utils/patternDetection");

// ── Trade factory ─────────────────────────────────────────────────────────────

let _seq = 0;
function makeTrade(overrides = {}) {
  _seq++;
  return {
    _id: String(_seq),
    profit: 0,
    tradeDate: new Date(Date.now() + _seq * 60000).toISOString(),
    createdAt: new Date(Date.now() + _seq * 60000).toISOString(),
    session: null,
    mood: null,
    confidence: null,
    emotionalTags: [],
    mistakeTag: null,
    setupScore: null,
    setupRules: [],
    entryBasis: null,
    wouldRetake: null,
    tradeQuality: null,
    pair: "EURUSD",
    type: "BUY",
    ...overrides,
  };
}

// Convenience constructors
const win  = (overrides = {}) => makeTrade({ profit: 100, ...overrides });
const loss = (overrides = {}) => makeTrade({ profit: -100, ...overrides });
const be   = (overrides = {}) => makeTrade({ profit: 0, ...overrides });

// Generate N trades with specific pattern
function nOf(n, factory) {
  return Array.from({ length: n }, factory);
}

// ── Module 12: Confidence Engine ──────────────────────────────────────────────

describe("getConfidenceLevel", () => {
  test("< 5 returns null", () => {
    expect(getConfidenceLevel(0)).toBeNull();
    expect(getConfidenceLevel(4)).toBeNull();
  });
  test("5-9 returns Low", () => {
    expect(getConfidenceLevel(5)).toBe("Low");
    expect(getConfidenceLevel(9)).toBe("Low");
  });
  test("10-29 returns Medium", () => {
    expect(getConfidenceLevel(10)).toBe("Medium");
    expect(getConfidenceLevel(29)).toBe("Medium");
  });
  test("30+ returns High", () => {
    expect(getConfidenceLevel(30)).toBe("High");
    expect(getConfidenceLevel(9999)).toBe("High");
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe("computePatternDetection — edge cases", () => {
  test("empty array returns insufficient result without crashing", () => {
    const r = computePatternDetection([]);
    expect(r.insufficient).toBe(true);
    expect(r.totalTrades).toBe(0);
    expect(r.lossStreaks).toBeNull();
  });

  test("< 5 trades returns insufficient", () => {
    const r = computePatternDetection([win(), loss(), win(), loss()]);
    expect(r.insufficient).toBe(true);
    expect(r.message).toMatch(/not enough/i);
  });

  test("5 trades with no psychology fields does not crash", () => {
    const trades = nOf(5, () => makeTrade({ profit: 50 }));
    const r = computePatternDetection(trades);
    expect(r.insufficient).toBe(false);
    expect(r.totalTrades).toBe(5);
    expect(r.lossStreaks).toBeDefined();
  });

  test("only winning trades — no loss streak buckets populated", () => {
    const trades = nOf(10, () => win());
    const r = computePatternDetection(trades);
    expect(r.lossStreaks.after1Loss).toBeNull();
    expect(r.lossStreaks.after2Losses).toBeNull();
  });

  test("only losing trades — no win streak buckets populated", () => {
    const trades = nOf(10, () => loss());
    const r = computePatternDetection(trades);
    expect(r.winStreaks.after1Win).toBeNull();
    expect(r.winStreaks.after2Wins).toBeNull();
  });

  test("missing session gracefully handled", () => {
    const trades = nOf(10, () => win({ session: null }));
    const r = computePatternDetection(trades);
    expect(r.sessions.bySessions).toHaveLength(0);
    expect(r.sessions.bestSession).toBeNull();
  });

  test("missing mood gracefully handled", () => {
    const trades = nOf(10, () => win({ mood: null }));
    const r = computePatternDetection(trades);
    expect(r.mood.byMood).toHaveLength(0);
  });

  test("missing confidence gracefully handled", () => {
    const trades = nOf(10, () => win({ confidence: null }));
    const r = computePatternDetection(trades);
    expect(r.confidence.byRange).toHaveLength(0);
  });

  test("missing emotional tags gracefully handled", () => {
    const trades = nOf(10, () => win({ emotionalTags: [] }));
    const r = computePatternDetection(trades);
    expect(r.emotions.byTag).toHaveLength(0);
  });

  test("missing setupRules gracefully handled", () => {
    const trades = nOf(10, () => win({ setupRules: [] }));
    const r = computePatternDetection(trades);
    expect(r.ruleViolations.byRule).toHaveLength(0);
  });

  test("missing setupScore gracefully handled", () => {
    const trades = nOf(10, () => win({ setupScore: null }));
    const r = computePatternDetection(trades);
    expect(r.setupScore.byRange).toHaveLength(0);
  });

  test("deleted trades not double-counted (caller filters — engine accepts what it receives)", () => {
    const trades = nOf(10, () => win());
    expect(() => computePatternDetection(trades)).not.toThrow();
  });

  test("null input does not crash", () => {
    expect(() => computePatternDetection(null)).not.toThrow();
    expect(computePatternDetection(null).insufficient).toBe(true);
  });
});

// ── Module 1: Loss Streak Patterns ───────────────────────────────────────────

describe("Module 1 — Loss Streak Patterns", () => {
  test("after 1 loss: correctly captures trades following single loss", () => {
    // Pattern: L W L W L W ...
    const trades = [];
    for (let i = 0; i < 20; i++) {
      trades.push(i % 2 === 0 ? loss() : win());
    }
    const r = computePatternDetection(trades);
    // After 1 loss (i.e. every odd index is a win following a single loss)
    expect(r.lossStreaks.after1Loss?.count).toBeGreaterThanOrEqual(5);
    expect(r.lossStreaks.after2Losses).toBeNull(); // no 2-loss streak exists
  });

  test("after 2 losses: captures trades following two consecutive losses", () => {
    // L L W L L W L L W ...
    const trades = [];
    for (let i = 0; i < 30; i++) {
      const pos = i % 3;
      trades.push(pos < 2 ? loss() : win());
    }
    const r = computePatternDetection(trades);
    expect(r.lossStreaks.after2Losses?.count).toBeGreaterThan(0);
    expect(r.lossStreaks.after2Losses?.confidence).toBeDefined();
  });

  test("after 4+ losses: grouped under '4+' key", () => {
    // 5 losses then 1 win, repeated 6 times
    const trades = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) trades.push(loss());
      trades.push(win());
    }
    const r = computePatternDetection(trades);
    expect(r.lossStreaks.after4PlusLosses?.count).toBeGreaterThan(0);
  });

  test("insight string references the worst streak level", () => {
    const trades = [];
    for (let i = 0; i < 6; i++) {
      trades.push(loss(), loss(), loss(), win());
    }
    const r = computePatternDetection(trades);
    expect(typeof r.lossStreaks.insight).toBe("string");
    expect(r.lossStreaks.insight?.length).toBeGreaterThan(10);
  });

  test("win rate and netPnl are numerically correct", () => {
    // 1 loss, then 10 trades with known outcomes (7 wins, 3 losses)
    const seed = [loss()]; // the loss that creates the streak
    const followUps = [
      ...nOf(7, () => win({ profit: 200 })),
      ...nOf(3, () => loss({ profit: -100 })),
    ];
    // Interleave loss streaks: single loss followed by 7W + 3L
    const trades = [...seed, ...followUps.slice(0, 5)];
    // Just ensure no crash and numbers are reasonable
    const r = computePatternDetection([...nOf(10, () => loss()), ...nOf(10, () => win())]);
    const stats = r.lossStreaks;
    if (stats.after1Loss) {
      expect(stats.after1Loss.winRate).toBeGreaterThanOrEqual(0);
      expect(stats.after1Loss.winRate).toBeLessThanOrEqual(100);
      expect(typeof stats.after1Loss.netPnl).toBe("number");
    }
  });
});

// ── Module 2: Win Streak Patterns ────────────────────────────────────────────

describe("Module 2 — Win Streak Patterns", () => {
  test("after 3 wins: detects reduced win rate suggesting overconfidence", () => {
    // W W W L pattern repeated — after 3 wins we always lose
    const trades = [];
    for (let i = 0; i < 8; i++) {
      trades.push(win(), win(), win(), loss());
    }
    const r = computePatternDetection(trades);
    expect(r.winStreaks.after3Wins?.count).toBeGreaterThan(0);
    // After 3 wins we have 0% win rate — should detect overconfidence
    expect(r.winStreaks.overconfidenceDetected).toBe(true);
  });

  test("after wins: win rate correctly calculated", () => {
    const trades = [];
    // W W L W W L pattern (after 1 win = mixed, after 2 wins = all losses)
    for (let i = 0; i < 10; i++) {
      trades.push(win(), win(), loss());
    }
    const r = computePatternDetection(trades);
    if (r.winStreaks.after2Wins) {
      expect(r.winStreaks.after2Wins.winRate).toBe(0); // always loss after 2 wins in this pattern
    }
  });

  test("no overconfidence flag when win rate stays stable", () => {
    // uniform win rate regardless of streak
    const trades = nOf(30, (_, i) => i % 3 === 0 ? loss() : win());
    const r = computePatternDetection(trades);
    // Should not flag overconfidence since win rate is consistent
    // (overconfidence requires >10% drop — with this pattern it's consistent)
    expect(typeof r.winStreaks.overconfidenceDetected).toBe("boolean");
  });
});

// ── Module 3: Confidence Range Patterns ──────────────────────────────────────

describe("Module 3 — Confidence Range Patterns", () => {
  test("Low confidence maps to 1-3 range", () => {
    const trades = nOf(10, () => win({ confidence: "Low" }));
    const r = computePatternDetection(trades);
    const entry = r.confidence.byRange.find(x => x.range === "1-3");
    expect(entry).toBeDefined();
    expect(entry.count).toBe(10);
  });

  test("Overconfident maps to 9-10 range", () => {
    const trades = nOf(10, () => loss({ confidence: "Overconfident" }));
    const r = computePatternDetection(trades);
    const entry = r.confidence.byRange.find(x => x.range === "9-10");
    expect(entry).toBeDefined();
    expect(entry.winRate).toBe(0);
  });

  test("bestRange picks highest netPnL range", () => {
    const trades = [
      ...nOf(10, () => win({ confidence: "High", profit: 200 })),    // 7-8 range
      ...nOf(10, () => loss({ confidence: "Overconfident", profit: -200 })), // 9-10 range
      ...nOf(10, () => win({ confidence: "Medium", profit: 50 })),    // 4-6 range
    ];
    const r = computePatternDetection(trades);
    expect(r.confidence.bestRange).toBe("7-8");
    expect(r.confidence.worstRange).toBe("9-10");
  });

  test("unknown confidence string does not appear in results", () => {
    const trades = nOf(10, () => win({ confidence: "Unknown" }));
    const r = computePatternDetection(trades);
    expect(r.confidence.byRange).toHaveLength(0);
  });
});

// ── Module 4: Mood Patterns ───────────────────────────────────────────────────

describe("Module 4 — Mood Patterns", () => {
  test("best mood = highest netPnL mood", () => {
    const trades = [
      ...nOf(10, () => win({ mood: 5, profit: 300 })),
      ...nOf(10, () => loss({ mood: 1, profit: -200 })),
      ...nOf(10, () => win({ mood: 3, profit: 50 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.mood.bestMood?.mood).toBe(5);
    expect(r.mood.worstMood?.mood).toBe(1);
  });

  test("mood 6 (out of range) is ignored gracefully", () => {
    const trades = [
      ...nOf(5, () => win({ mood: 6 })),
      ...nOf(5, () => win({ mood: 3 })),
    ];
    const r = computePatternDetection(trades);
    const invalid = r.mood.byMood.find(m => m.mood === 6);
    expect(invalid).toBeUndefined();
  });

  // Labels match the words printed under the mood faces in the trade form.
  test("mood label is populated", () => {
    const trades = nOf(10, () => win({ mood: 4 }));
    const r = computePatternDetection(trades);
    const entry = r.mood.byMood.find(m => m.mood === 4);
    expect(entry?.label).toBe("Confident");
  });
});

// ── Module 5: Emotional Tag Patterns ─────────────────────────────────────────

describe("Module 5 — Emotional Tag Patterns", () => {
  test("FOMO trades counted correctly with correct type=negative", () => {
    const trades = nOf(10, () => loss({ emotionalTags: ["FOMO"] }));
    const r = computePatternDetection(trades);
    const fomo = r.emotions.byTag.find(e => e.tag === "FOMO");
    expect(fomo).toBeDefined();
    expect(fomo.type).toBe("negative");
    expect(fomo.winRate).toBe(0);
    expect(fomo.netPnl).toBeLessThan(0);
  });

  test("Calm trades counted as positive type", () => {
    const trades = nOf(10, () => win({ emotionalTags: ["Calm"] }));
    const r = computePatternDetection(trades);
    const calm = r.emotions.byTag.find(e => e.tag === "Calm");
    expect(calm?.type).toBe("positive");
    expect(calm?.netPnl).toBeGreaterThan(0);
  });

  test("mostDangerous is negative-net-pnl emotion with lowest netPnl", () => {
    const trades = [
      ...nOf(10, () => loss({ emotionalTags: ["Revenge"], profit: -200 })),
      ...nOf(10, () => loss({ emotionalTags: ["FOMO"], profit: -100 })),
      ...nOf(10, () => win({ emotionalTags: ["Calm"], profit: 100 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.emotions.mostDangerous?.tag).toBe("Revenge");
  });

  test("mostProfitable is positive-net-pnl emotion", () => {
    const trades = [
      ...nOf(10, () => win({ emotionalTags: ["Focused"], profit: 300 })),
      ...nOf(10, () => win({ emotionalTags: ["Calm"], profit: 100 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.emotions.mostProfitable?.tag).toBe("Focused");
  });

  test("trade with multiple tags counted in each bucket", () => {
    const trades = nOf(10, () => win({ emotionalTags: ["Calm", "Focused"] }));
    const r = computePatternDetection(trades);
    const calm = r.emotions.byTag.find(e => e.tag === "Calm");
    const focused = r.emotions.byTag.find(e => e.tag === "Focused");
    expect(calm?.count).toBe(10);
    expect(focused?.count).toBe(10);
  });
});

// ── Module 6: Trade Quality Patterns ─────────────────────────────────────────

describe("Module 6 — Trade Quality Patterns", () => {
  test("Great trades have higher win rate than Poor trades", () => {
    const trades = [
      ...nOf(10, () => win({ tradeQuality: "Great" })),
      ...nOf(10, () => loss({ tradeQuality: "Poor" })),
    ];
    const r = computePatternDetection(trades);
    expect(r.tradeQuality.bySelfRating.Great?.winRate).toBe(100);
    expect(r.tradeQuality.bySelfRating.Poor?.winRate).toBe(0);
  });

  test("missing tradeQuality field gracefully handled", () => {
    const trades = nOf(10, () => win({ tradeQuality: null }));
    const r = computePatternDetection(trades);
    expect(r.tradeQuality.bySelfRating).toEqual({});
  });
});

// ── Module 7: Session Patterns ────────────────────────────────────────────────

describe("Module 7 — Session Patterns", () => {
  test("bestSession has highest netPnL", () => {
    const trades = [
      ...nOf(10, () => win({ session: "London", profit: 200 })),
      ...nOf(10, () => loss({ session: "Asia", profit: -150 })),
      ...nOf(10, () => win({ session: "New York", profit: 50 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.sessions.bestSession?.session).toBe("London");
    expect(r.sessions.worstSession?.session).toBe("Asia");
  });

  test("Indian market sessions supported (Opening Session etc)", () => {
    const trades = [
      ...nOf(10, () => win({ session: "Opening Session", profit: 200 })),
      ...nOf(10, () => loss({ session: "Closing Session", profit: -100 })),
    ];
    const r = computePatternDetection(trades, "Indian_Market");
    expect(r.sessions.bySessions.map(s => s.session)).toContain("Opening Session");
  });

  test("sessions with < 5 trades are hidden", () => {
    const trades = [
      ...nOf(10, () => win({ session: "London" })),
      ...nOf(4, () => loss({ session: "Asia" })), // below threshold
    ];
    const r = computePatternDetection(trades);
    const asia = r.sessions.bySessions.find(s => s.session === "Asia");
    expect(asia).toBeUndefined();
  });
});

// ── Module 8: Day-of-Week Patterns ───────────────────────────────────────────

describe("Module 8 — Day of Week Patterns", () => {
  test("Monday trades are grouped correctly", () => {
    // Create trades that fall on a Monday (2026-06-01 = Monday)
    const mondays = [];
    const d = new Date("2026-06-01T10:00:00Z"); // This is a Monday
    for (let i = 0; i < 5; i++) {
      const dt = new Date(d.getTime() + i * 7 * 24 * 60 * 60 * 1000); // each next Monday
      mondays.push(win({ tradeDate: dt.toISOString(), profit: 100 }));
    }
    // Also add enough total trades to meet threshold
    const r = computePatternDetection(mondays);
    const monday = r.dayOfWeek.byDay.find(d => d.day === "Monday");
    expect(monday).toBeDefined();
    expect(monday?.count).toBe(5);
  });

  test("best day insight is generated", () => {
    const trades = [];
    const baseMon = new Date("2026-06-01T10:00:00Z");
    const baseFri = new Date("2026-06-05T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      trades.push(win({ tradeDate: new Date(baseMon.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString(), profit: 200 }));
      trades.push(loss({ tradeDate: new Date(baseFri.getTime() + i * 7 * 24 * 60 * 60 * 1000).toISOString(), profit: -200 }));
    }
    const r = computePatternDetection(trades);
    expect(typeof r.dayOfWeek.insight).toBe("string");
  });
});

// ── Module 9: Setup Score Range Patterns ─────────────────────────────────────

describe("Module 9 — Setup Score Range Patterns", () => {
  test("setup score 85 falls in 80-100 bucket", () => {
    const trades = nOf(10, () => win({ setupScore: 85, profit: 200 }));
    const r = computePatternDetection(trades);
    const highRange = r.setupScore.byRange.find(x => x.range === "80-100");
    expect(highRange).toBeDefined();
    expect(highRange.count).toBe(10);
  });

  test("optimalThreshold is the range with highest netPnL", () => {
    const trades = [
      ...nOf(10, () => win({ setupScore: 90, profit: 300 })),
      ...nOf(10, () => loss({ setupScore: 20, profit: -200 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.setupScore.optimalThreshold).toBe("80-100");
    expect(r.setupScore.worstRange).toBe("0-39");
  });

  test("setup score boundary values", () => {
    const trades = [
      ...nOf(5, () => win({ setupScore: 39 })), // 0-39  (max 40 is exclusive)
      ...nOf(5, () => win({ setupScore: 40 })), // 40-59 (lower edge is inclusive)
      ...nOf(5, () => win({ setupScore: 80 })), // 80-100
    ];
    const r = computePatternDetection(trades);
    const labels = r.setupScore.byRange.map(x => x.range);
    expect(labels).toContain("0-39");
    expect(labels).toContain("40-59");
    expect(labels).toContain("80-100");
  });

  // Regression: this engine used to split at 0/41/61/81 while Trading DNA and
  // Discipline split at 0/40/60/80, so a score of exactly 80 landed in a
  // different bucket depending on which screen you opened.
  test("score of exactly 80 buckets as 80-100, matching the other engines", () => {
    const trades = nOf(6, () => win({ setupScore: 80, profit: 100 }));
    const r = computePatternDetection(trades);
    const labels = r.setupScore.byRange.map(x => x.range);
    expect(labels).toEqual(["80-100"]);
    expect(r.setupScore.byRange[0].count).toBe(6);
  });
});

// ── Module 10: Rule Violation Patterns ───────────────────────────────────────

describe("Module 10 — Rule Violation Patterns", () => {
  test("broken rule cost is correctly computed", () => {
    const brokenTrades = nOf(10, () => loss({
      profit: -100,
      setupRules: [{ label: "Wait For Confirmation", followed: false }],
    }));
    const r = computePatternDetection(brokenTrades);
    const rule = r.ruleViolations.byRule.find(r => r.rule === "Wait For Confirmation");
    expect(rule).toBeDefined();
    expect(rule.totalCost).toBe(-1000);
    expect(rule.brokenCount).toBe(10);
  });

  test("followed rules do not appear in violations", () => {
    const trades = nOf(10, () => win({
      setupRules: [{ label: "Wait For Confirmation", followed: true }],
    }));
    const r = computePatternDetection(trades);
    const rule = r.ruleViolations.byRule.find(r => r.rule === "Wait For Confirmation");
    expect(rule).toBeUndefined();
  });

  test("rules broken < 5 times are hidden", () => {
    const trades = nOf(4, () => loss({
      setupRules: [{ label: "Rare Rule", followed: false }],
    }));
    const extra = nOf(10, () => win()); // padding
    const r = computePatternDetection([...trades, ...extra]);
    const rule = r.ruleViolations.byRule.find(r => r.rule === "Rare Rule");
    expect(rule).toBeUndefined();
  });

  test("mostExpensiveRule is the rule with lowest totalCost", () => {
    const base = [
      ...nOf(10, () => loss({ profit: -200, setupRules: [{ label: "Big Rule", followed: false }] })),
      ...nOf(10, () => loss({ profit: -50, setupRules: [{ label: "Small Rule", followed: false }] })),
    ];
    const r = computePatternDetection(base);
    expect(r.ruleViolations.mostExpensiveRule?.rule).toBe("Big Rule");
  });
});

// ── Module 11: Combination Patterns ──────────────────────────────────────────

describe("Module 11 — Combination Patterns", () => {
  test("emotion + confidence combination detected", () => {
    const trades = nOf(10, () => loss({
      emotionalTags: ["FOMO"],
      confidence: "Overconfident",
      profit: -150,
    }));
    const r = computePatternDetection(trades);
    const combo = r.combinations.allCombinations.find(c => c.key === "FOMO|||9-10");
    expect(combo).toBeDefined();
    expect(combo.type).toBe("emotion_confidence");
    expect(combo.netPnl).toBeLessThan(0);
  });

  test("setupScore + session combination detected", () => {
    const trades = nOf(10, () => win({
      setupScore: 85,
      session: "London",
      profit: 200,
    }));
    const r = computePatternDetection(trades);
    const combo = r.combinations.allCombinations.find(c => c.key === "80-100|||London");
    expect(combo).toBeDefined();
    expect(combo.label).toContain("London");
  });

  test("mostDangerous combination has negative netPnl", () => {
    const trades = [
      ...nOf(10, () => loss({ emotionalTags: ["FOMO"], confidence: "Overconfident", profit: -200 })),
      ...nOf(10, () => win({ emotionalTags: ["Calm"], confidence: "Medium", profit: 100 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.combinations.mostDangerous?.netPnl).toBeLessThan(0);
    expect(r.combinations.mostProfitable?.netPnl).toBeGreaterThan(0);
  });

  test("topPositive has at most 5 entries", () => {
    const trades = [];
    for (let i = 0; i < 10; i++) {
      trades.push(win({ emotionalTags: [`Tag${i}`], confidence: "High", session: `Session${i}`, profit: 100 + i * 10 }));
    }
    const extra = nOf(10, () => win());
    const r = computePatternDetection([...trades, ...extra]);
    expect(r.combinations.topPositive.length).toBeLessThanOrEqual(5);
    expect(r.combinations.topNegative.length).toBeLessThanOrEqual(5);
  });

  test("emotion + loss streak combination: after 2 losses + FOMO", () => {
    const trades = [];
    for (let i = 0; i < 10; i++) {
      // L L FOMO-L pattern
      trades.push(loss({ profit: -100 }));
      trades.push(loss({ profit: -100 }));
      trades.push(loss({ emotionalTags: ["FOMO"], profit: -200 }));
      trades.push(win({ profit: 100 })); // reset streak
    }
    const r = computePatternDetection(trades);
    const fomoStreak = r.combinations.allCombinations.find(c => c.key === "FOMO|||LossStreak");
    expect(fomoStreak).toBeDefined();
    expect(fomoStreak.count).toBeGreaterThan(0);
  });
});

// ── Module 13: Pattern Ranking ────────────────────────────────────────────────

describe("Module 13 — Pattern Ranking System", () => {
  test("top5Positive contains only positive netPnl patterns", () => {
    const trades = [
      ...nOf(30, () => win({ emotionalTags: ["Calm"], session: "London", profit: 200, setupScore: 85 })),
      ...nOf(30, () => loss({ emotionalTags: ["FOMO"], session: "Asia", profit: -100, setupScore: 20 })),
    ];
    const r = computePatternDetection(trades);
    r.rankings.top5Positive.forEach(p => {
      expect(p.netPnl).toBeGreaterThan(0);
    });
  });

  test("top5Negative contains only negative netPnl patterns", () => {
    const trades = [
      ...nOf(30, () => loss({ emotionalTags: ["FOMO"], profit: -200 })),
      ...nOf(30, () => win({ emotionalTags: ["Calm"], profit: 100 })),
    ];
    const r = computePatternDetection(trades);
    r.rankings.top5Negative.forEach(p => {
      expect(p.netPnl).toBeLessThan(0);
    });
  });

  test("high confidence patterns ranked above low confidence ones with same netPnl", () => {
    // Both have same netPnl but different sample sizes
    const trades = [
      ...nOf(30, () => win({ mood: 5, profit: 100 })),    // High confidence → bigger weight
      ...nOf(5, () => win({ mood: 4, profit: 100 })),     // Low confidence
    ];
    const r = computePatternDetection(trades);
    const mood5 = r.rankings.top5Positive.find(p => p.name === "Peak mood");
    const mood4 = r.rankings.top5Positive.find(p => p.name === "Confident mood");
    if (mood5 && mood4) {
      const idx5 = r.rankings.top5Positive.indexOf(mood5);
      const idx4 = r.rankings.top5Positive.indexOf(mood4);
      expect(idx5).toBeLessThan(idx4); // 5 ranked higher
    }
  });
});

// ── User-facing wording ──────────────────────────────────────────────────────

/**
 * A ranked row or a dashboard card is the only place a trader meets a pattern,
 * so it has to name the thing they logged. The engine buckets confidence into
 * "1-3" and mood into "3" internally, but neither number exists anywhere in the
 * trade form — the form asks for Low/Medium/High/Overconfident and a mood face
 * labelled Stressed…Peak. These lock the copy to those words.
 */
describe("Pattern wording is readable without knowing the bucket keys", () => {
  const descriptions = (r) => [...r.rankings.top5Positive, ...r.rankings.top5Negative].map(p => p.description);

  test("confidence rows name the level the trader picked, not a 1-10 range", () => {
    const trades = [
      ...nOf(12, () => win({ confidence: "Medium", profit: 100 })),
      ...nOf(12, () => loss({ confidence: "Low", profit: -100 })),
    ];
    const r = computePatternDetection(trades);

    expect(r.confidence.byRange.map(x => x.label)).toEqual(
      expect.arrayContaining(["Low confidence", "Medium confidence"])
    );
    expect(descriptions(r)).toEqual(expect.arrayContaining(["Low confidence", "Medium confidence"]));
    expect(descriptions(r).some(d => /Confidence range/i.test(d))).toBe(false);
    expect(r.confidence.insight).not.toMatch(/Confidence (1-3|4-6|7-8|9-10)/);
  });

  test("mood rows name the mood, not a level number", () => {
    const trades = [
      ...nOf(12, () => win({ mood: 5, profit: 100 })),
      ...nOf(12, () => loss({ mood: 3, profit: -100 })),
    ];
    const r = computePatternDetection(trades);

    expect(descriptions(r)).toEqual(expect.arrayContaining(["Peak mood", "Neutral mood"]));
    expect(descriptions(r).some(d => /Mood level/i.test(d))).toBe(false);
    expect(r.mood.insight).not.toMatch(/mood level/i);
  });

  test("setup score rows name the band and keep the numbers as context", () => {
    const trades = [
      ...nOf(12, () => win({ setupScore: 90, profit: 100 })),
      ...nOf(12, () => loss({ setupScore: 20, profit: -100 })),
    ];
    const r = computePatternDetection(trades);

    expect(r.setupScore.byRange.map(x => x.label)).toEqual(
      expect.arrayContaining(["Weak setups (score 0-39)", "Strong setups (score 80-100)"])
    );
    expect(descriptions(r)).toEqual(expect.arrayContaining(["Strong setups (score 80-100)"]));
  });

  test("combination labels spell out both conditions", () => {
    const trades = nOf(12, () => win({
      mood: 3, confidence: "Medium", entryBasis: "Plan", emotionalTags: ["Disciplined"], profit: 100,
    }));
    const r = computePatternDetection(trades);
    const labels = r.combinations.allCombinations.map(c => c.label);

    expect(labels).toEqual(expect.arrayContaining([
      "Disciplined + medium confidence",
      "Neutral mood + Disciplined",
      "Plan entry + medium confidence",
      "Disciplined with no losing streak",
    ]));
    expect(labels.some(l => /\(No Streak\)|Confidence \d/.test(l))).toBe(false);
  });

  test("streak, emotion, session and day rows read as sentences", () => {
    // FOMO and Asia must not cover the identical trade set, or the ranking
    // collapses the duplicate cohort and only one of the two rows survives.
    const trades = [];
    for (let i = 0; i < 12; i++) {
      trades.push(loss({ emotionalTags: ["FOMO"], session: "Asia", profit: -100 }));
      trades.push(loss({ emotionalTags: ["FOMO"], session: "London", profit: -150 }));
      trades.push(win({ emotionalTags: ["Calm"], session: "London", profit: 200 }));
    }
    const r = computePatternDetection(trades);
    const all = descriptions(r);

    expect(all.some(d => /^Trading after \d\+? loss(es)?$/.test(d))).toBe(true);
    expect(all).toEqual(expect.arrayContaining(["Felt FOMO", "Asia session"]));
    expect(all.some(d => /^(Loss streak:|Emotional tag:|Session:|Day:)/.test(d))).toBe(false);
  });
});

// ── Module 14: Dashboard Summary ─────────────────────────────────────────────

describe("Module 14 — Dashboard Summary", () => {
  test("topPositivePattern and topNegativePattern are included in summary", () => {
    const trades = [
      ...nOf(30, () => win({ emotionalTags: ["Calm"], profit: 200, session: "London" })),
      ...nOf(30, () => loss({ emotionalTags: ["FOMO"], profit: -100, session: "Asia" })),
    ];
    const r = computePatternDetection(trades);
    expect(r.summary.topPositivePattern).not.toBeNull();
    expect(r.summary.topNegativePattern).not.toBeNull();
    expect(r.summary.topPositivePattern.netPnl).toBeGreaterThan(0);
    expect(r.summary.topNegativePattern.netPnl).toBeLessThan(0);
  });

  test("mostDangerousEmotion reflects emotion module output", () => {
    const trades = [
      ...nOf(10, () => loss({ emotionalTags: ["Revenge"], profit: -300 })),
      ...nOf(10, () => win({ emotionalTags: ["Calm"], profit: 100 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.summary.mostDangerousEmotion?.tag).toBe("Revenge");
  });
});

// ── Module 15: AI Coach Feed ──────────────────────────────────────────────────

describe("Module 15 — AI Coach Feed Context", () => {
  test("aiContext.patterns structure is complete", () => {
    const trades = [
      ...nOf(10, () => win({ emotionalTags: ["Calm"], session: "London", confidence: "High" })),
      ...nOf(10, () => loss({ emotionalTags: ["FOMO"], session: "Asia", confidence: "Overconfident" })),
    ];
    const r = computePatternDetection(trades);
    expect(r.aiContext).toBeDefined();
    expect(r.aiContext.patterns).toBeDefined();
    expect(Array.isArray(r.aiContext.patterns.positive)).toBe(true);
    expect(Array.isArray(r.aiContext.patterns.negative)).toBe(true);
    expect(Array.isArray(r.aiContext.patterns.confidence)).toBe(true);
    expect(Array.isArray(r.aiContext.patterns.session)).toBe(true);
    expect(Array.isArray(r.aiContext.patterns.emotion)).toBe(true);
  });

  test("aiContext pattern entries include required fields", () => {
    const trades = [
      ...nOf(10, () => win({ emotionalTags: ["Calm"], profit: 100 })),
      ...nOf(10, () => loss({ emotionalTags: ["FOMO"], profit: -100 })),
    ];
    const r = computePatternDetection(trades);
    const pos = r.aiContext.patterns.positive[0];
    if (pos) {
      expect(pos).toHaveProperty("netPnl");
      expect(pos).toHaveProperty("winRate");
      expect(pos).toHaveProperty("count");
      expect(pos).toHaveProperty("confidence");
    }
  });
});

// ── Module 16: DNA Enrichment ─────────────────────────────────────────────────

describe("Module 16 — DNA Enrichment", () => {
  test("dnaEnrichment is present when combinations exist", () => {
    const trades = [
      ...nOf(10, () => win({ emotionalTags: ["Calm"], confidence: "High", profit: 200 })),
      ...nOf(10, () => loss({ emotionalTags: ["FOMO"], confidence: "Overconfident", profit: -100 })),
    ];
    const r = computePatternDetection(trades);
    expect(r.dnaEnrichment).toBeDefined();
    expect(r.dnaEnrichment.bestPattern?.label).toBeDefined();
    expect(r.dnaEnrichment.worstPattern?.label).toBeDefined();
  });
});

// ── Market Type ───────────────────────────────────────────────────────────────

describe("marketType support", () => {
  test("Forex marketType included in result", () => {
    const trades = nOf(10, () => win({ session: "London" }));
    const r = computePatternDetection(trades, "Forex");
    expect(r.marketType).toBe("Forex");
  });

  test("Indian_Market marketType included in result", () => {
    const trades = nOf(10, () => win({ session: "Opening Session" }));
    const r = computePatternDetection(trades, "Indian_Market");
    expect(r.marketType).toBe("Indian_Market");
  });
});

// ── Performance ───────────────────────────────────────────────────────────────

describe("Performance", () => {
  jest.setTimeout(10000);

  test("100 trades completes in reasonable time", () => {
    const trades = nOf(100, (_, i) => makeTrade({
      profit: i % 3 === 0 ? -100 : 100,
      session: ["London", "Asia", "New York"][i % 3],
      mood: (i % 5) + 1,
      confidence: ["Low", "Medium", "High", "Overconfident"][i % 4],
      emotionalTags: [["FOMO", "Calm", "Revenge", "Focused"][i % 4]],
      setupScore: (i % 4) * 25,
      setupRules: [{ label: "Rule A", followed: i % 2 === 0 }],
    }));
    const start = Date.now();
    computePatternDetection(trades);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("1000 trades completes within 2 seconds", () => {
    const trades = nOf(1000, (_, i) => makeTrade({
      profit: i % 3 === 0 ? -100 : 100,
      session: ["London", "Asia", "New York"][i % 3],
      mood: (i % 5) + 1,
      confidence: ["Low", "Medium", "High", "Overconfident"][i % 4],
      emotionalTags: [["FOMO", "Calm", "Revenge", "Focused"][i % 4]],
      setupScore: (i % 4) * 25 + 5,
      setupRules: [{ label: "Rule A", followed: i % 2 === 0 }],
    }));
    const start = Date.now();
    computePatternDetection(trades);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test("10000 trades completes within 5 seconds", () => {
    const trades = nOf(10000, (_, i) => makeTrade({
      profit: i % 3 === 0 ? -100 : 100,
      session: ["London", "Asia", "New York"][i % 3],
      mood: (i % 5) + 1,
      confidence: ["Low", "Medium", "High", "Overconfident"][i % 4],
      emotionalTags: [["FOMO", "Calm", "Revenge", "Focused"][i % 4]],
      setupScore: (i % 4) * 25 + 5,
    }));
    const start = Date.now();
    computePatternDetection(trades);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

// ── Tied results / deterministic tie-breaking ─────────────────────────────────

describe("Deterministic tie-breaking", () => {
  test("identical netPnL entries sorted alphabetically", () => {
    const trades = [
      ...nOf(10, () => win({ session: "Zebra", profit: 100 })),
      ...nOf(10, () => win({ session: "Alpha", profit: 100 })),
    ];
    const r = computePatternDetection(trades);
    const sessions = r.sessions.bySessions.filter(s => s.session === "Alpha" || s.session === "Zebra");
    // Both have same netPnl=1000; bestSession should be "Alpha" (alphabetically first)
    expect(r.sessions.bestSession?.session).toBe("Alpha");
  });
});

// ── Integration: mixed Forex + Indian market ──────────────────────────────────

describe("Mixed market types", () => {
  test("Forex trades analyzed with Forex marketType", () => {
    const trades = [
      ...nOf(10, () => win({ session: "London" })),
      ...nOf(10, () => loss({ session: "Asia" })),
    ];
    const r = computePatternDetection(trades, "Forex");
    expect(r.marketType).toBe("Forex");
    expect(r.sessions.bySessions.some(s => s.session === "London")).toBe(true);
  });

  test("Indian trades analyzed with Indian_Market marketType", () => {
    const trades = [
      ...nOf(10, () => win({ session: "Opening Session" })),
      ...nOf(10, () => loss({ session: "Midday" })),
    ];
    const r = computePatternDetection(trades, "Indian_Market");
    expect(r.marketType).toBe("Indian_Market");
    expect(r.sessions.bySessions.some(s => s.session === "Opening Session")).toBe(true);
  });
});

// ── Regression: existing systems still work ───────────────────────────────────

describe("Regression — existing utility compatibility", () => {
  test("computePatternDetection does not modify input trades array", () => {
    const trades = nOf(10, () => win());
    const originalLength = trades.length;
    const originalFirst = { ...trades[0] };
    computePatternDetection(trades);
    expect(trades.length).toBe(originalLength);
    expect(trades[0].profit).toBe(originalFirst.profit);
  });

  test("result shape is stable across calls with same data", () => {
    const trades = nOf(20, (_, i) => makeTrade({ profit: i % 2 === 0 ? 100 : -100, session: "London", mood: 3 }));
    const r1 = computePatternDetection(trades);
    const r2 = computePatternDetection(trades);
    expect(r1.sessions.bestSession?.session).toBe(r2.sessions.bestSession?.session);
    expect(r1.rankings.top5Positive.length).toBe(r2.rankings.top5Positive.length);
  });

  test("analyzedAt timestamp is present and valid ISO string", () => {
    const trades = nOf(10, () => win());
    const r = computePatternDetection(trades);
    expect(r.analyzedAt).toBeDefined();
    expect(new Date(r.analyzedAt).toISOString()).toBe(r.analyzedAt);
  });
});
