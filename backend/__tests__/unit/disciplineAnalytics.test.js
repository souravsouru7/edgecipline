"use strict";

const {
  computeDisciplineAnalytics,
  computeChecklistCompliance,
  computeRuleAnalytics,
  computeSetupPerformance,
  computeDisciplineTimeline,
  computePsychologyCorrelation,
  computeDisciplinePatterns,
  computeOverview,
  computeCoachInsights,
  computeDNAIntegration,
  computeTrend,
  getTrackedRules,
} = require("../../utils/disciplineAnalytics");

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeTrade(overrides = {}) {
  return {
    profit:      100,
    tradeDate:   new Date("2026-03-15T10:00:00Z"),
    strategy:    "Breakout",
    session:     "London",
    setupScore:  80,
    setupRules:  [
      { label: "Trend Alignment", followed: true  },
      { label: "Volume Check",    followed: true  },
    ],
    entryBasis:    "Plan",
    mood:          4,
    confidence:    "Medium",
    emotionalTags: [],
    ...overrides,
  };
}

function makeTrades(n, overrides = {}) {
  return Array.from({ length: n }, (_, i) => makeTrade({
    tradeDate: new Date(`2026-0${Math.floor(i / 8) + 1}-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
    ...overrides,
  }));
}

function makeRuleTrade(label, followed, profit = 100, extra = {}) {
  return makeTrade({
    profit,
    setupRules: [{ label, followed }],
    setupScore: followed ? 100 : 0,
    ...extra,
  });
}

// ── getTrackedRules ────────────────────────────────────────────────────────────

describe("getTrackedRules", () => {
  it("returns only rules with explicit true/false", () => {
    const t = makeTrade({ setupRules: [
      { label: "A", followed: true  },
      { label: "B", followed: false },
      { label: "C", followed: null  },
      { label: "D"                  }, 
    ]});
    const r = getTrackedRules(t);
    expect(r).toHaveLength(2);
    expect(r.map(x => x.label)).toEqual(["A", "B"]);
  });

  it("returns empty array for trade with no setupRules", () => {
    expect(getTrackedRules(makeTrade({ setupRules: undefined }))).toHaveLength(0);
    expect(getTrackedRules(makeTrade({ setupRules: []         }))).toHaveLength(0);
  });

  it("ignores rules without a label", () => {
    const t = makeTrade({ setupRules: [{ followed: true }, { label: "Valid", followed: true }] });
    expect(getTrackedRules(t).map(r => r.label)).toEqual(["Valid"]);
  });
});



describe("computeTrend", () => {
  it("stable for < 4 values", () => {
    expect(computeTrend([50, 60, 70])).toBe("stable");
  });
  it("improving", () => {
    expect(computeTrend([40, 55, 70, 80, 90])).toBe("improving");
  });
  it("declining", () => {
    expect(computeTrend([90, 75, 60, 45, 30])).toBe("declining");
  });
  it("stable for flat line", () => {
    expect(computeTrend([70, 70, 70, 70, 70])).toBe("stable");
  });
  it("handles null values", () => {
    expect(computeTrend([null, 50, null, 70, 85, 90])).toBe("improving");
  });
  it("returns stable when all nulls", () => {
    expect(computeTrend([null, null, null, null, null])).toBe("stable");
  });
});

// ── computeChecklistCompliance ─────────────────────────────────────────────────

describe("computeChecklistCompliance", () => {
  it("returns null compliancePct for trades with no tracked rules", () => {
    const trades = [makeTrade({ setupRules: [] })];
    const r = computeChecklistCompliance(trades);
    expect(r.compliancePct).toBeNull();
    expect(r.totalRulesEvaluated).toBe(0);
  });

  it("computes 100% compliance when all rules followed", () => {
    const trades = makeTrades(5, {
      setupRules: [
        { label: "Rule A", followed: true },
        { label: "Rule B", followed: true },
      ],
    });
    const r = computeChecklistCompliance(trades);
    expect(r.compliancePct).toBe(100);
    expect(r.totalRulesFollowed).toBe(10);
    expect(r.totalRulesBroken).toBe(0);
  });

  it("computes 0% compliance when all rules broken", () => {
    const trades = makeTrades(5, {
      setupRules: [{ label: "Rule A", followed: false }],
    });
    const r = computeChecklistCompliance(trades);
    expect(r.compliancePct).toBe(0);
    expect(r.totalRulesFollowed).toBe(0);
    expect(r.totalRulesBroken).toBe(5);
  });

  it("computes 50% compliance correctly", () => {
    const trades = [
      makeTrade({ setupRules: [{ label: "Rule A", followed: true  }] }),
      makeTrade({ setupRules: [{ label: "Rule A", followed: false }] }),
    ];
    const r = computeChecklistCompliance(trades);
    expect(r.compliancePct).toBe(50);
  });

  it("identifies mostFollowedRule and mostSkippedRule", () => {
    const trades = [
      makeTrade({ setupRules: [{ label: "A", followed: true  }, { label: "B", followed: false }] }),
      makeTrade({ setupRules: [{ label: "A", followed: true  }, { label: "B", followed: false }] }),
      makeTrade({ setupRules: [{ label: "A", followed: true  }, { label: "C", followed: false }] }),
    ];
    const r = computeChecklistCompliance(trades);
    expect(r.mostFollowedRule).toBe("A");
    expect(r.mostSkippedRule).toBe("B");
  });

  it("ignores rules with undefined/null followed", () => {
    const trades = [
      makeTrade({ setupRules: [{ label: "A", followed: true }, { label: "B" }] }),
    ];
    const r = computeChecklistCompliance(trades);
    expect(r.totalRulesEvaluated).toBe(1);
    expect(r.totalRulesFollowed).toBe(1);
  });
});

// ── computeRuleAnalytics ───────────────────────────────────────────────────────

describe("computeRuleAnalytics", () => {
  it("returns empty arrays when no trades have rules", () => {
    const { ruleAnalytics, topByCost, topByFrequency } = computeRuleAnalytics(
      makeTrades(5, { setupRules: [] })
    );
    expect(ruleAnalytics).toHaveLength(0);
    expect(topByCost).toHaveLength(0);
    expect(topByFrequency).toHaveLength(0);
  });

  it("computes per-rule performance correctly", () => {
    const trades = [
      makeRuleTrade("Volume Confirmation", true,   200),
      makeRuleTrade("Volume Confirmation", true,   150),
      makeRuleTrade("Volume Confirmation", false, -300),
    ];
    const { ruleAnalytics } = computeRuleAnalytics(trades);
    const rule = ruleAnalytics.find(r => r.label === "Volume Confirmation");
    expect(rule).toBeDefined();
    expect(rule.timesFollowed).toBe(2);
    expect(rule.timesBroken).toBe(1);
    expect(rule.compliancePct).toBe(66.7);
    expect(rule.netPnLFollowed).toBe(350);
    expect(rule.netPnLBroken).toBe(-300);
    expect(rule.costOfBreaking).toBe(300);
    expect(rule.pnlDifference).toBeGreaterThan(0); // following >> breaking
  });

  it("winRateFollowed is 100% when all followed trades win", () => {
    const trades = [
      makeRuleTrade("Rule A", true, 100),
      makeRuleTrade("Rule A", true, 200),
    ];
    const { ruleAnalytics } = computeRuleAnalytics(trades);
    expect(ruleAnalytics[0].winRateFollowed).toBe(100);
  });

  it("costOfBreaking is 0 when broken trades are profitable", () => {
    const trades = [makeRuleTrade("Rule A", false, 100)];
    const { ruleAnalytics } = computeRuleAnalytics(trades);
    expect(ruleAnalytics[0].costOfBreaking).toBe(0);
  });

  it("treats separate rule labels as separate rules (no merge)", () => {
    const trades = [
      makeRuleTrade("Volume Confirmation", true, 100),
      makeRuleTrade("volume confirmation", true, 100),  // different case = different rule
    ];
    const { ruleAnalytics } = computeRuleAnalytics(trades);
    expect(ruleAnalytics).toHaveLength(2);
  });

  it("topByCost sorted by costOfBreaking desc", () => {
    const trades = [
      makeRuleTrade("Cheap Rule",      false, -50),
      makeRuleTrade("Expensive Rule",  false, -500),
      makeRuleTrade("Mid Rule",        false, -200),
    ];
    const { topByCost } = computeRuleAnalytics(trades);
    expect(topByCost[0].label).toBe("Expensive Rule");
    expect(topByCost[1].label).toBe("Mid Rule");
  });

  it("topByFrequency sorted by timesBroken desc", () => {
    const trades = [
      ...Array(5).fill(null).map(() => makeRuleTrade("Often Broken", false, -10)),
      makeRuleTrade("Rarely Broken", false, -500),
    ];
    const { topByFrequency } = computeRuleAnalytics(trades);
    expect(topByFrequency[0].label).toBe("Often Broken");
  });

  it("winRateFollowed null when never followed", () => {
    const trades = [makeRuleTrade("Only Broken", false, -100)];
    const { ruleAnalytics } = computeRuleAnalytics(trades);
    expect(ruleAnalytics[0].winRateFollowed).toBeNull();
    expect(ruleAnalytics[0].winRateBroken).toBe(0);
  });

  it("aggregates same rule across multiple strategies", () => {
    const trades = [
      makeRuleTrade("Trend Alignment", true,  200, { strategy: "Breakout" }),
      makeRuleTrade("Trend Alignment", false, -100, { strategy: "Reversal" }),
    ];
    const { ruleAnalytics } = computeRuleAnalytics(trades);
    const rule = ruleAnalytics[0];
    expect(rule.timesFollowed).toBe(1);
    expect(rule.timesBroken).toBe(1);
  });
});

// ── computeSetupPerformance ───────────────────────────────────────────────────

describe("computeSetupPerformance", () => {
  it("returns empty for no trades", () => {
    const { setupPerformance, bestSetup, worstSetup } = computeSetupPerformance([]);
    expect(setupPerformance).toHaveLength(0);
    expect(bestSetup).toBeNull();
    expect(worstSetup).toBeNull();
  });

  it("groups by strategy correctly", () => {
    const trades = [
      makeTrade({ strategy: "Breakout", profit: 200, setupScore: 90 }),
      makeTrade({ strategy: "Breakout", profit: 150, setupScore: 85 }),
      makeTrade({ strategy: "Reversal", profit: -100, setupScore: 40 }),
    ];
    const { setupPerformance } = computeSetupPerformance(trades);
    expect(setupPerformance.map(s => s.setupName)).toContain("Breakout");
    expect(setupPerformance.map(s => s.setupName)).toContain("Reversal");
  });

  it("uses Unspecified for trades without strategy", () => {
    const trades = [makeTrade({ strategy: "" })];
    const { setupPerformance } = computeSetupPerformance(trades);
    expect(setupPerformance[0].setupName).toBe("Unspecified");
  });

  it("computes correct win rate", () => {
    const trades = [
      makeTrade({ strategy: "A", profit:  100 }),
      makeTrade({ strategy: "A", profit: -100 }),
    ];
    const { setupPerformance } = computeSetupPerformance(trades);
    expect(setupPerformance[0].winRate).toBe(50);
  });

  it("bestSetup has highest netPnL among qualified setups", () => {
    const trades = [
      ...Array(5).fill(null).map(() => makeTrade({ strategy: "Best",  profit: 200 })),
      ...Array(5).fill(null).map(() => makeTrade({ strategy: "Worst", profit: -100 })),
    ];
    const { bestSetup, worstSetup } = computeSetupPerformance(trades);
    expect(bestSetup.setupName).toBe("Best");
    expect(worstSetup.setupName).toBe("Worst");
  });

  it("avgSetupScore null when no scores present", () => {
    const trades = [makeTrade({ strategy: "A", setupScore: undefined })];
    const { setupPerformance } = computeSetupPerformance(trades);
    expect(setupPerformance[0].avgSetupScore).toBeNull();
  });

  it("avgDisciplineScore null when no rules present", () => {
    const trades = [makeTrade({ strategy: "A", setupRules: [] })];
    const { setupPerformance } = computeSetupPerformance(trades);
    expect(setupPerformance[0].avgDisciplineScore).toBeNull();
  });
});

// ── computeDisciplineTimeline ─────────────────────────────────────────────────

describe("computeDisciplineTimeline", () => {
  it("returns empty buckets for no trades", () => {
    const r = computeDisciplineTimeline([]);
    expect(r.buckets).toHaveLength(0);
  });

  it("groups by month correctly", () => {
    const trades = [
      makeTrade({ tradeDate: new Date("2026-01-10T10:00:00Z"), setupScore: 70 }),
      makeTrade({ tradeDate: new Date("2026-02-10T10:00:00Z"), setupScore: 80 }),
    ];
    const r = computeDisciplineTimeline(trades, { period: "monthly" });
    expect(r.buckets).toHaveLength(2);
    expect(r.buckets[0].key).toBe("2026-01");
    expect(r.buckets[1].key).toBe("2026-02");
  });

  it("groups by day correctly", () => {
    const trades = [
      makeTrade({ tradeDate: new Date("2026-03-01T10:00:00Z") }),
      makeTrade({ tradeDate: new Date("2026-03-02T10:00:00Z") }),
    ];
    const r = computeDisciplineTimeline(trades, { period: "daily" });
    expect(r.buckets).toHaveLength(2);
    expect(r.buckets[0].key).toBe("2026-03-01");
  });

  it("includes compliancePct per bucket", () => {
    const trades = [
      makeTrade({
        tradeDate:  new Date("2026-01-10T10:00:00Z"),
        setupRules: [
          { label: "A", followed: true  },
          { label: "B", followed: false },
        ],
      }),
    ];
    const r = computeDisciplineTimeline(trades, { period: "monthly" });
    expect(r.buckets[0].compliancePct).toBe(50);
  });

  it("disciplineScore null when no setupScores in bucket", () => {
    const trades = [
      makeTrade({
        tradeDate:  new Date("2026-01-10T10:00:00Z"),
        setupScore: undefined,
        setupRules: [{ label: "A", followed: true }],
      }),
    ];
    const r = computeDisciplineTimeline(trades, { period: "monthly" });
    expect(r.buckets[0].disciplineScore).toBeNull();
    expect(r.buckets[0].compliancePct).toBe(100);
  });

  it("applies timezone offset correctly", () => {
    // Trade at 2026-01-01T23:30:00Z → UTC day = 2026-01-01
    // With +5.5h offset → shifted to 2026-01-02
    const trade = makeTrade({ tradeDate: new Date("2026-01-01T23:30:00Z") });
    const utc = computeDisciplineTimeline([trade], { period: "daily", offsetHours: 0 });
    const ist = computeDisciplineTimeline([trade], { period: "daily", offsetHours: 5.5 });
    expect(utc.buckets[0].key).toBe("2026-01-01");
    expect(ist.buckets[0].key).toBe("2026-01-02");
  });

  it("computes trend from buckets", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
    const trades = [];
    months.forEach((m, i) => {
      trades.push(makeTrade({ tradeDate: new Date(`${m}-10T10:00:00Z`), setupScore: 40 + i * 12 }));
    });
    const r = computeDisciplineTimeline(trades, { period: "monthly" });
    expect(r.trend).toBe("improving");
  });
});

// ── computePsychologyCorrelation ──────────────────────────────────────────────

describe("computePsychologyCorrelation", () => {
  it("returns empty arrays for trades without discipline data", () => {
    const trades = [makeTrade({ setupScore: undefined, emotionalTags: [] })];
    const r = computePsychologyCorrelation(trades);
    expect(r.bySetupRange).toHaveLength(0);
  });

  it("groups by setup score range correctly", () => {
    const trades = [
      makeTrade({ setupScore: 90, profit: 200 }),  // 80-100
      makeTrade({ setupScore: 30, profit: -100 }), // 0-39
    ];
    const r = computePsychologyCorrelation(trades);
    const high = r.bySetupRange.find(x => x.range === "80–100");
    const low  = r.bySetupRange.find(x => x.range === "0–39");
    expect(high).toBeDefined();
    expect(low).toBeDefined();
    expect(high.winRate).toBe(100);
    expect(low.winRate).toBe(0);
  });

  it("correlates mood with setup score", () => {
    const trades = [
      makeTrade({ setupScore: 90, mood: 5 }),
      makeTrade({ setupScore: 40, mood: 1 }),
    ];
    const r = computePsychologyCorrelation(trades);
    expect(r.byMood).toHaveLength(2);
    const mood5 = r.byMood.find(m => m.mood === 5);
    const mood1 = r.byMood.find(m => m.mood === 1);
    expect(mood5.avgSetupScore).toBe(90);
    expect(mood1.avgSetupScore).toBe(40);
  });

  it("correlates emotion tags with setup score", () => {
    const trades = [
      makeTrade({ setupScore: 85, emotionalTags: ["Calm"] }),
      makeTrade({ setupScore: 30, emotionalTags: ["FOMO"] }),
    ];
    const r = computePsychologyCorrelation(trades);
    const calm = r.byEmotionalTag.find(t => t.tag === "Calm");
    const fomo = r.byEmotionalTag.find(t => t.tag === "FOMO");
    expect(calm.avgSetupScore).toBeGreaterThan(fomo.avgSetupScore);
    expect(calm.isPos).toBe(true);
    expect(fomo.isNeg).toBe(true);
  });

  it("returns byConfidence sorted in logical order", () => {
    const trades = [
      makeTrade({ setupScore: 70, confidence: "High"   }),
      makeTrade({ setupScore: 60, confidence: "Medium" }),
      makeTrade({ setupScore: 50, confidence: "Low"    }),
    ];
    const r = computePsychologyCorrelation(trades);
    const labels = r.byConfidence.map(c => c.confidence);
    expect(labels.indexOf("Low")).toBeLessThan(labels.indexOf("Medium"));
    expect(labels.indexOf("Medium")).toBeLessThan(labels.indexOf("High"));
  });
});

// ── computeDisciplinePatterns ─────────────────────────────────────────────────

describe("computeDisciplinePatterns", () => {
  it("returns empty for no trades with setupScore", () => {
    const r = computeDisciplinePatterns([makeTrade({ setupScore: undefined })]);
    expect(r.patterns).toHaveLength(0);
    expect(r.best).toBeNull();
    expect(r.worst).toBeNull();
  });

  it("identifies high discipline + positive emotion pattern", () => {
    const trades = Array.from({ length: 5 }, () =>
      makeTrade({ setupScore: 90, emotionalTags: ["Calm"], profit: 200 })
    );
    const r = computeDisciplinePatterns(trades);
    const p = r.patterns.find(x => x.key === "high_disc_pos_emotion");
    expect(p).toBeDefined();
    expect(p.winRate).toBe(100);
    expect(p.type).toBe("positive");
  });

  it("identifies low discipline + negative emotion pattern", () => {
    const trades = Array.from({ length: 5 }, () =>
      makeTrade({ setupScore: 20, emotionalTags: ["FOMO"], profit: -150 })
    );
    const r = computeDisciplinePatterns(trades);
    const p = r.patterns.find(x => x.key === "low_disc_neg_emotion");
    expect(p).toBeDefined();
    expect(p.type).toBe("negative");
    expect(p.netPnL).toBe(-750);
  });

  it("excludes patterns with < 3 trades", () => {
    const trades = [
      makeTrade({ setupScore: 90, emotionalTags: ["Calm"], profit: 100 }),
      makeTrade({ setupScore: 90, emotionalTags: ["Calm"], profit: 100 }),
    ];
    const r = computeDisciplinePatterns(trades);
    expect(r.patterns.find(x => x.key === "high_disc_pos_emotion")).toBeUndefined();
  });

  it("best is positive pattern with highest win rate", () => {
    const trades = [
      ...Array(5).fill(null).map(() => makeTrade({ setupScore: 90, emotionalTags: ["Calm"],   profit: 200 })),
      ...Array(5).fill(null).map(() => makeTrade({ setupScore: 90, entryBasis: "Plan",        profit: 150 })),
    ];
    const r = computeDisciplinePatterns(trades);
    expect(r.best).not.toBeNull();
    expect(r.best.type).toBe("positive");
  });
});

// ── computeDNAIntegration ─────────────────────────────────────────────────────

describe("computeDNAIntegration", () => {
  it("returns null fields when no qualified rules", () => {
    const r = computeDNAIntegration([], { bestSetup: null, worstSetup: null });
    expect(r.strongestRule).toBeNull();
    expect(r.weakestRule).toBeNull();
    expect(r.mostValuableRule).toBeNull();
    expect(r.mostExpensiveViolation).toBeNull();
  });

  it("identifies strongestRule (highest compliance)", () => {
    const ruleAnalytics = [
      { label: "A", compliancePct: 90, pnlDifference: 50, timesFollowed: 9,  timesBroken: 1,  confidence: "Medium", costOfBreaking: 50 },
      { label: "B", compliancePct: 40, pnlDifference: 10, timesFollowed: 4,  timesBroken: 6,  confidence: "Low",    costOfBreaking: 100 },
      { label: "C", compliancePct: 70, pnlDifference: 30, timesFollowed: 7,  timesBroken: 3,  confidence: "Medium", costOfBreaking: 200 },
    ];
    const r = computeDNAIntegration(ruleAnalytics, { bestSetup: null, worstSetup: null });
    expect(r.strongestRule.label).toBe("A");
  });

  it("identifies weakestRule (lowest compliance)", () => {
    const ruleAnalytics = [
      { label: "A", compliancePct: 90, pnlDifference: 50, timesFollowed: 9,  timesBroken: 1,  confidence: "High",   costOfBreaking: 50 },
      { label: "B", compliancePct: 20, pnlDifference: 10, timesFollowed: 2,  timesBroken: 8,  confidence: "High",   costOfBreaking: 800 },
    ];
    const r = computeDNAIntegration(ruleAnalytics, { bestSetup: null, worstSetup: null });
    expect(r.weakestRule.label).toBe("B");
  });

  it("identifies mostValuableRule (highest pnlDifference)", () => {
    const ruleAnalytics = [
      { label: "A", compliancePct: 80, pnlDifference: 100, timesFollowed: 8, timesBroken: 2, confidence: "High",   costOfBreaking: 50 },
      { label: "B", compliancePct: 70, pnlDifference: 200, timesFollowed: 5, timesBroken: 3, confidence: "Medium", costOfBreaking: 300 },
    ];
    const r = computeDNAIntegration(ruleAnalytics, { bestSetup: null, worstSetup: null });
    expect(r.mostValuableRule.label).toBe("B");
  });

  it("identifies mostExpensiveViolation (highest costOfBreaking)", () => {
    const ruleAnalytics = [
      { label: "A", compliancePct: 80, pnlDifference: 50,  timesFollowed: 8, timesBroken: 5, confidence: "High", costOfBreaking: 1000 },
      { label: "B", compliancePct: 70, pnlDifference: 100, timesFollowed: 5, timesBroken: 5, confidence: "High", costOfBreaking: 200  },
    ];
    const r = computeDNAIntegration(ruleAnalytics, { bestSetup: null, worstSetup: null });
    expect(r.mostExpensiveViolation.label).toBe("A");
  });

  it("passes through bestSetup and worstSetup from setupData", () => {
    const best  = { setupName: "Breakout", trades: 10 };
    const worst = { setupName: "Reversal", trades: 10 };
    const r = computeDNAIntegration([], { bestSetup: best, worstSetup: worst });
    expect(r.bestSetup).toBe(best);
    expect(r.worstSetup).toBe(worst);
  });
});

// ── computeCoachInsights ───────────────────────────────────────────────────────

describe("computeCoachInsights", () => {
  function makeData(overrides = {}) {
    return {
      overview:      { allTimeScore: 75, currentScore: 78, trend: "stable" },
      compliance:    { compliancePct: 70, totalRulesEvaluated: 20, totalRulesFollowed: 14, totalRulesBroken: 6, mostSkippedRule: "Volume Check" },
      ruleAnalytics: [],
      setupData:     { bestSetup: null, worstSetup: null },
      correlation:   { bySetupRange: [] },
      patterns:      { best: null, worst: null },
      dna:           { mostExpensiveViolation: null, mostValuableRule: null },
      ...overrides,
    };
  }

  it("returns empty array for minimal valid data", () => {
    const insights = computeCoachInsights(makeData(), "$");
    expect(Array.isArray(insights)).toBe(true);
  });

  it("generates low-compliance insight when compliance < 60%", () => {
    const data = makeData({
      compliance: { compliancePct: 45, totalRulesEvaluated: 20, totalRulesFollowed: 9, totalRulesBroken: 11, mostSkippedRule: "Trend Check" },
    });
    const insights = computeCoachInsights(data, "$");
    expect(insights.some(i => i.id === "discipline-low-compliance")).toBe(true);
  });

  it("does NOT generate low-compliance insight when compliance ≥ 60%", () => {
    const data = makeData({ compliance: { compliancePct: 70, totalRulesEvaluated: 10, totalRulesFollowed: 7, totalRulesBroken: 3, mostSkippedRule: null } });
    const insights = computeCoachInsights(data, "$");
    expect(insights.some(i => i.id === "discipline-low-compliance")).toBe(false);
  });

  it("generates trend-improving insight", () => {
    const data = makeData({ overview: { allTimeScore: 75, currentScore: 80, trend: "improving" } });
    const insights = computeCoachInsights(data, "$");
    expect(insights.some(i => i.id === "discipline-trend-improving")).toBe(true);
  });

  it("generates trend-declining insight", () => {
    const data = makeData({ overview: { allTimeScore: 75, currentScore: 60, trend: "declining" } });
    const insights = computeCoachInsights(data, "$");
    expect(insights.some(i => i.id === "discipline-trend-declining")).toBe(true);
  });

  it("generates most-violated-rule insight", () => {
    const data = makeData({
      ruleAnalytics: [{
        label: "Volume Check", timesFollowed: 10, timesBroken: 12,
        winRateFollowed: 70, winRateBroken: 25, confidence: "Medium",
      }],
    });
    const insights = computeCoachInsights(data, "$");
    expect(insights.some(i => i.title.includes("Volume Check"))).toBe(true);
  });

  it("generates setup-score threshold insight when gap is significant", () => {
    const data = makeData({
      correlation: {
        bySetupRange: [
          { range: "80–100", count: 10, winRate: 80, netPnL: 1000 },
          { range: "0–39",   count: 5,  winRate: 20, netPnL: -200 },
        ],
      },
    });
    const insights = computeCoachInsights(data, "$");
    expect(insights.some(i => i.id === "discipline-score-threshold")).toBe(true);
  });

  it("all insight IDs are unique strings", () => {
    const data = makeData({
      overview:   { allTimeScore: 60, currentScore: 50, trend: "declining" },
      compliance: { compliancePct: 40, totalRulesEvaluated: 20, totalRulesFollowed: 8, totalRulesBroken: 12, mostSkippedRule: "X" },
      ruleAnalytics: [{
        label: "Volume Check", timesFollowed: 5, timesBroken: 8,
        winRateFollowed: 70, winRateBroken: 25, confidence: "Medium",
      }],
    });
    const insights = computeCoachInsights(data, "$");
    const ids = insights.map(i => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── computeOverview ────────────────────────────────────────────────────────────

describe("computeOverview", () => {
  it("returns null scores when no discipline data", () => {
    const trades = [makeTrade({ setupScore: undefined, setupRules: [] })];
    const r = computeOverview(trades, []);
    expect(r.currentScore).toBeNull();
    expect(r.allTimeScore).toBeNull();
  });

  it("computes allTimeScore from setupScore", () => {
    const trades = [
      makeTrade({ setupScore: 80, tradeDate: new Date(Date.now() - 60 * 86400000) }),
      makeTrade({ setupScore: 60, tradeDate: new Date(Date.now() - 60 * 86400000) }),
    ];
    const r = computeOverview(trades, []);
    expect(r.allTimeScore).toBe(70);
  });

  it("currentScore only reflects last 7 days", () => {
    const recent = makeTrade({ setupScore: 90, tradeDate: new Date(Date.now() - 2 * 86400000) });
    const old    = makeTrade({ setupScore: 40, tradeDate: new Date(Date.now() - 60 * 86400000) });
    const r = computeOverview([recent, old], []);
    expect(r.currentScore).toBe(90);
    expect(r.allTimeScore).toBe(65);
  });

  it("trend comes from timeline buckets", () => {
    const buckets = [
      { disciplineScore: 40 }, { disciplineScore: 55 },
      { disciplineScore: 70 }, { disciplineScore: 85 }, { disciplineScore: 95 },
    ];
    const r = computeOverview([], buckets);
    expect(r.trend).toBe("improving");
  });
});

// ── computeDisciplineAnalytics (integration) ───────────────────────────────────

describe("computeDisciplineAnalytics", () => {
  it("returns insufficient for empty trades array", () => {
    const r = computeDisciplineAnalytics([]);
    expect(r.insufficient).toBe(true);
    expect(r.reason).toBe("no_trades");
  });

  it("returns insufficient for null input", () => {
    const r = computeDisciplineAnalytics(null);
    expect(r.insufficient).toBe(true);
  });

  it("returns insufficient when trades have no setup data", () => {
    const trades = [makeTrade({ setupScore: undefined, setupRules: [] })];
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(true);
    expect(r.reason).toBe("no_setup_data");
  });

  it("returns full result structure for valid trades", () => {
    const trades = makeTrades(10);
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(false);
    expect(r).toHaveProperty("overview");
    expect(r).toHaveProperty("compliance");
    expect(r).toHaveProperty("ruleAnalytics");
    expect(r).toHaveProperty("ruleCostAnalytics");
    expect(r).toHaveProperty("setupPerformance");
    expect(r).toHaveProperty("timeline");
    expect(r).toHaveProperty("psychologyCorrelation");
    expect(r).toHaveProperty("disciplinePatterns");
    expect(r).toHaveProperty("dnaIntegration");
    expect(r).toHaveProperty("coachInsights");
    expect(r).toHaveProperty("stats");
  });

  it("includes generatedAt ISO timestamp", () => {
    const trades = makeTrades(5);
    const r = computeDisciplineAnalytics(trades);
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("marketType is passed through", () => {
    const trades = makeTrades(5);
    const r = computeDisciplineAnalytics(trades, { marketType: "Indian_Market" });
    expect(r.marketType).toBe("Indian_Market");
    expect(r.stats.currency).toBe("₹");
  });

  it("handles Forex marketType with $ currency", () => {
    const trades = makeTrades(5);
    const r = computeDisciplineAnalytics(trades, { marketType: "Forex" });
    expect(r.stats.currency).toBe("$");
  });

  it("period is passed through to timeline", () => {
    const trades = makeTrades(5);
    const r = computeDisciplineAnalytics(trades, { period: "weekly" });
    expect(r.period).toBe("weekly");
    expect(r.timeline.period).toBe("weekly");
  });

  it("handles trades with only setupScore (no setupRules)", () => {
    const trades = makeTrades(5, { setupRules: [], setupScore: 75 });
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(false);
    expect(r.overview.allTimeScore).toBe(75);
    expect(r.compliance.totalRulesEvaluated).toBe(0);
  });

  it("handles trades with only setupRules (no setupScore)", () => {
    const trades = makeTrades(5, {
      setupScore: undefined,
      setupRules: [{ label: "Rule A", followed: true }],
    });
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(false);
    expect(r.compliance.totalRulesFollowed).toBe(5);
  });

  it("does not crash with 0% compliance", () => {
    const trades = makeTrades(10, {
      setupScore: 0,
      setupRules: [{ label: "A", followed: false }, { label: "B", followed: false }],
    });
    expect(() => computeDisciplineAnalytics(trades)).not.toThrow();
    const r = computeDisciplineAnalytics(trades);
    expect(r.compliance.compliancePct).toBe(0);
  });

  it("does not crash with 100% compliance", () => {
    const trades = makeTrades(10, {
      setupScore: 100,
      setupRules: [{ label: "A", followed: true }, { label: "B", followed: true }],
    });
    expect(() => computeDisciplineAnalytics(trades)).not.toThrow();
    const r = computeDisciplineAnalytics(trades);
    expect(r.compliance.compliancePct).toBe(100);
  });

  it("handles OCR trades missing checklist data gracefully", () => {
    const trades = [
      makeTrade({ setupScore: undefined, setupRules: undefined }),
      makeTrade({ setupScore: 80 }),
    ];
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(false);
    expect(r.stats.tradesWithScore).toBe(1);
  });

  it("handles single rule correctly", () => {
    const trades = Array.from({ length: 5 }, () =>
      makeTrade({ setupRules: [{ label: "Only Rule", followed: true }] })
    );
    const r = computeDisciplineAnalytics(trades);
    expect(r.ruleAnalytics).toHaveLength(1);
    expect(r.ruleAnalytics[0].compliancePct).toBe(100);
  });

  it("handles all winning trades without assuming discipline caused everything", () => {
    const trades = makeTrades(10, { profit: 500, setupScore: 50 });
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(false);
    // Should still compute analytics without error
    expect(r.setupPerformance[0].winRate).toBe(100);
  });

  it("handles all losing trades correctly", () => {
    const trades = makeTrades(10, { profit: -200, setupScore: 30 });
    const r = computeDisciplineAnalytics(trades);
    expect(r.insufficient).toBe(false);
    expect(r.setupPerformance[0].winRate).toBe(0);
  });

  // Performance test: 10000 trades with 20 rules each should complete quickly
  it("handles 10000 trades in reasonable time", () => {
    const many = Array.from({ length: 10000 }, (_, i) => makeTrade({
      tradeDate:  new Date(Date.now() - i * 3600 * 1000),
      setupRules: Array.from({ length: 5 }, (__, j) => ({
        label:    `Rule ${j}`,
        followed: Math.random() > 0.3,
      })),
      setupScore: Math.round(Math.random() * 100),
    }));
    const start = Date.now();
    const r = computeDisciplineAnalytics(many);
    const elapsed = Date.now() - start;
    expect(r.insufficient).toBe(false);
    expect(elapsed).toBeLessThan(3000); // must complete within 3s
  });

  it("uniqueRules count reflects distinct rule labels", () => {
    const trades = [
      makeTrade({ setupRules: [{ label: "A", followed: true  }, { label: "B", followed: false }] }),
      makeTrade({ setupRules: [{ label: "A", followed: false }, { label: "C", followed: true  }] }),
    ];
    const r = computeDisciplineAnalytics(trades);
    expect(r.stats.uniqueRules).toBe(3); // A, B, C
  });

  it("coachInsights is always an array", () => {
    const r = computeDisciplineAnalytics(makeTrades(5));
    expect(Array.isArray(r.coachInsights)).toBe(true);
  });

  it("timeline buckets are sorted chronologically", () => {
    const trades = [
      makeTrade({ tradeDate: new Date("2026-03-01T10:00:00Z") }),
      makeTrade({ tradeDate: new Date("2026-01-01T10:00:00Z") }),
      makeTrade({ tradeDate: new Date("2026-02-01T10:00:00Z") }),
    ];
    const r = computeDisciplineAnalytics(trades, { period: "monthly" });
    const keys = r.timeline.buckets.map(b => b.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("does not share mutable state across calls", () => {
    const trades1 = makeTrades(5, { strategy: "A" });
    const trades2 = makeTrades(5, { strategy: "B" });
    const r1 = computeDisciplineAnalytics(trades1);
    const r2 = computeDisciplineAnalytics(trades2);
    expect(r1.setupPerformance[0].setupName).toBe("A");
    expect(r2.setupPerformance[0].setupName).toBe("B");
  });
});
