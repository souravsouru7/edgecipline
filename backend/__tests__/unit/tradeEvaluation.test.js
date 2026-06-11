const { calculateActualTradeQuality, computeSelfAwarenessAnalytics } = require("../../utils/tradeEvaluation");

// ── calculateActualTradeQuality ───────────────────────────────────────────────

describe("calculateActualTradeQuality", () => {
  const fullGreat = {
    setupScore: 90,
    entryBasis: "Plan",
    mood: 5,
    emotionalTags: ["Calm", "Focused"],
    wouldRetake: "Yes",
    confidence: "High",
  };

  const fullPoor = {
    setupScore: 10,
    entryBasis: "Impulsive",
    mood: 1,
    emotionalTags: ["FOMO", "Revenge"],
    wouldRetake: "No",
    confidence: "Overconfident",
  };

  test("Great trade → tier Great, score ≥70", () => {
    const r = calculateActualTradeQuality(fullGreat);
    expect(r.tier).toBe("Great");
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.factorsUsed).toBe(5);
  });

  test("Poor trade → tier Poor, score <45", () => {
    const r = calculateActualTradeQuality(fullPoor);
    expect(r.tier).toBe("Poor");
    expect(r.score).toBeLessThan(45);
  });

  test("Average trade → tier Average, score 45-69", () => {
    // setupScore 50 (20pts) + Emotion entry (6pts) + mood 3 no tags (~8pts) + Yes retake (10pts) + Medium conf (10pts) = 54/100
    const avg = {
      setupScore: 50,
      entryBasis: "Emotion",
      mood: 3,
      emotionalTags: [],
      wouldRetake: "Yes",
      confidence: "Medium",
    };
    const r = calculateActualTradeQuality(avg);
    expect(r.tier).toBe("Average");
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.score).toBeLessThan(70);
  });

  test("setupScore boundary: 100 → max setup contribution 40", () => {
    const r = calculateActualTradeQuality({ setupScore: 100, entryBasis: "Plan" });
    expect(r.breakdown.setupScore.pts).toBe(40);
    expect(r.factorsUsed).toBe(2);
  });

  test("setupScore boundary: 0 → setup contribution 0", () => {
    const r = calculateActualTradeQuality({ setupScore: 0, entryBasis: "Plan" });
    expect(r.breakdown.setupScore.pts).toBe(0);
  });

  test("missing setupScore still evaluates using other factors", () => {
    const r = calculateActualTradeQuality({
      entryBasis: "Plan",
      mood: 4,
      emotionalTags: ["Calm"],
      wouldRetake: "Yes",
      confidence: "Medium",
    });
    expect(r.tier).not.toBeNull();
    expect(r.factorsUsed).toBe(4);
  });

  test("negative emotional tags reduce score", () => {
    const withFOMO    = calculateActualTradeQuality({ setupScore: 60, entryBasis: "Plan", emotionalTags: ["FOMO", "Revenge"] });
    const withoutTags = calculateActualTradeQuality({ setupScore: 60, entryBasis: "Plan" });
    expect(withFOMO.score).toBeLessThan(withoutTags.score);
  });

  test("FOMO + Revenge tags reduce emotional score significantly", () => {
    const r = calculateActualTradeQuality({ mood: 5, emotionalTags: ["FOMO", "Revenge", "Fear"], setupScore: 80 });
    expect(r.breakdown.emotional.pts).toBeLessThan(14);
  });

  test("Overconfident confidence penalised vs Medium", () => {
    const over = calculateActualTradeQuality({ setupScore: 70, entryBasis: "Plan", confidence: "Overconfident" });
    const med  = calculateActualTradeQuality({ setupScore: 70, entryBasis: "Plan", confidence: "Medium" });
    expect(over.score).toBeLessThan(med.score);
  });

  test("Impulsive entry → lowest entry contribution", () => {
    const r = calculateActualTradeQuality({ setupScore: 50, entryBasis: "Impulsive" });
    expect(r.breakdown.entryBasis.pts).toBe(0);
  });

  test("Plan entry → highest entry contribution", () => {
    const r = calculateActualTradeQuality({ setupScore: 50, entryBasis: "Plan" });
    expect(r.breakdown.entryBasis.pts).toBe(20);
  });

  test("wouldRetake Yes → 10 pts; No → 0 pts", () => {
    const yes = calculateActualTradeQuality({ setupScore: 50, entryBasis: "Plan", wouldRetake: "Yes" });
    const no  = calculateActualTradeQuality({ setupScore: 50, entryBasis: "Plan", wouldRetake: "No" });
    expect(yes.breakdown.wouldRetake.pts).toBe(10);
    expect(no.breakdown.wouldRetake.pts).toBe(0);
  });

  test("fewer than 2 factors → tier null, score null", () => {
    const r = calculateActualTradeQuality({ setupScore: 80 }); // only 1 factor
    expect(r.tier).toBeNull();
    expect(r.score).toBeNull();
    expect(r.factorsUsed).toBe(1);
  });

  test("no data at all → tier null", () => {
    const r = calculateActualTradeQuality({});
    expect(r.tier).toBeNull();
    expect(r.factorsUsed).toBe(0);
  });

  test("null / undefined fields treated as missing, not zero", () => {
    const r = calculateActualTradeQuality({ setupScore: null, entryBasis: null });
    expect(r.factorsUsed).toBe(0);
    expect(r.tier).toBeNull();
  });

  test("emotionalTags clamped to [0,20]", () => {
    // Many negative tags should not push pts below 0
    const r = calculateActualTradeQuality({
      mood: 1,
      emotionalTags: ["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"],
      setupScore: 50,
    });
    expect(r.breakdown.emotional.pts).toBeGreaterThanOrEqual(0);
    expect(r.breakdown.emotional.pts).toBeLessThanOrEqual(20);
  });

  test("score normalised to 0-100", () => {
    const r = calculateActualTradeQuality(fullGreat);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

// ── computeSelfAwarenessAnalytics ─────────────────────────────────────────────

describe("computeSelfAwarenessAnalytics", () => {
  const makeTrade = (tradeQuality, overrides = {}) => ({
    tradeQuality,
    setupScore: 70,
    entryBasis: "Plan",
    mood: 4,
    emotionalTags: ["Calm"],
    wouldRetake: "Yes",
    confidence: "High",
    profit: 100,
    ...overrides,
  });

  test("empty trades → score null, trackedCount 0", () => {
    const r = computeSelfAwarenessAnalytics([]);
    expect(r.score).toBeNull();
    expect(r.trackedCount).toBe(0);
  });

  test("no tradeQuality fields → score null", () => {
    const trades = [{ setupScore: 80, entryBasis: "Plan", profit: 50 }];
    const r = computeSelfAwarenessAnalytics(trades);
    expect(r.score).toBeNull();
    expect(r.trackedCount).toBe(0);
  });

  test("all correct evaluations → score 100", () => {
    // Great self-rating + high system score → Great system tier
    const trades = [
      makeTrade("Great"),
      makeTrade("Great"),
      makeTrade("Great"),
    ];
    const r = computeSelfAwarenessAnalytics(trades);
    expect(r.score).toBe(100);
    expect(r.matchCount).toBe(3);
  });

  test("all incorrect evaluations → score 0", () => {
    // Poor self-rating but system says Great (high execution signals)
    const trades = Array(5).fill(null).map(() => makeTrade("Poor"));
    const r = computeSelfAwarenessAnalytics(trades);
    expect(r.score).toBe(0);
    expect(r.matchCount).toBe(0);
  });

  test("50% correct → score 50", () => {
    const correct   = Array(5).fill(null).map(() => makeTrade("Great"));
    const incorrect = Array(5).fill(null).map(() => makeTrade("Poor")); // system says Great
    const r = computeSelfAwarenessAnalytics([...correct, ...incorrect]);
    expect(r.score).toBe(50);
  });

  test("matrix rows sum to per-category totals", () => {
    const trades = [
      makeTrade("Great"),
      makeTrade("Great"),
      makeTrade("Average", { setupScore: 50, mood: 3, emotionalTags: [] }),
      makeTrade("Poor",    { setupScore: 10, entryBasis: "Impulsive", mood: 1, emotionalTags: ["FOMO"], wouldRetake: "No", confidence: "Overconfident" }),
    ];
    const r = computeSelfAwarenessAnalytics(trades);
    const TIERS = ["Great", "Average", "Poor"];
    for (const u of TIERS) {
      const rowSum = TIERS.reduce((s, c) => s + (r.matrix?.[u]?.[c] || 0), 0);
      expect(rowSum).toBe(r.perCategory?.[u]?.total ?? 0);
    }
  });

  test("overconfident count: Great self-rating where system ≠ Great", () => {
    // Great self-rating + poor execution signals → system says Poor
    const overTrade = makeTrade("Great", {
      setupScore: 10,
      entryBasis: "Impulsive",
      mood: 1,
      emotionalTags: ["FOMO"],
      wouldRetake: "No",
      confidence: "Overconfident",
    });
    const r = computeSelfAwarenessAnalytics([overTrade, makeTrade("Great"), makeTrade("Great")]);
    expect(r.overconfident).toBeGreaterThanOrEqual(1);
  });

  test("underconfident count: Poor self-rating where system ≠ Poor", () => {
    const underTrade = makeTrade("Poor"); // system says Great
    const r = computeSelfAwarenessAnalytics([underTrade, underTrade, underTrade]);
    expect(r.underconfident).toBe(3);
  });

  test("trades without tradeQuality excluded from count", () => {
    const trades = [
      makeTrade("Great"),
      { setupScore: 80, entryBasis: "Plan", profit: 50 }, // no tradeQuality
    ];
    const r = computeSelfAwarenessAnalytics(trades);
    expect(r.trackedCount).toBe(1);
    expect(r.totalTrades).toBe(2);
  });

  test("trades with insufficient evaluation data excluded", () => {
    // Only setupScore — 1 factor, below minimum 2
    const trades = [
      { tradeQuality: "Great", setupScore: 90, profit: 100 },
      makeTrade("Great"),
    ];
    const r = computeSelfAwarenessAnalytics(trades);
    expect(r.trackedCount).toBe(1);
  });

  test("breakdown limited to last 20 trades", () => {
    const trades = Array(30).fill(null).map(() => makeTrade("Great"));
    const r = computeSelfAwarenessAnalytics(trades);
    expect(r.breakdown.length).toBeLessThanOrEqual(20);
  });

  test("bestJudgedCategory has highest accuracy among categories with ≥2 trades", () => {
    const trades = [
      makeTrade("Great"), makeTrade("Great"),
      makeTrade("Poor",  { setupScore: 10, entryBasis: "Impulsive", mood: 1, emotionalTags: ["FOMO"], wouldRetake: "No", confidence: "Overconfident" }),
      makeTrade("Poor",  { setupScore: 10, entryBasis: "Impulsive", mood: 1, emotionalTags: ["FOMO"], wouldRetake: "No", confidence: "Overconfident" }),
    ];
    const r = computeSelfAwarenessAnalytics(trades);
    if (r.bestJudgedCategory) {
      const bestAcc  = r.perCategory?.[r.bestJudgedCategory]?.accuracy ?? 0;
      const otherMax = ["Great","Average","Poor"]
        .filter(t => t !== r.bestJudgedCategory && (r.perCategory?.[t]?.total ?? 0) >= 2)
        .reduce((m, t) => Math.max(m, r.perCategory?.[t]?.accuracy ?? 0), 0);
      expect(bestAcc).toBeGreaterThanOrEqual(otherMax);
    }
  });

  test("patterns array is non-null and is an array", () => {
    const trades = Array(5).fill(null).map(() => makeTrade("Great"));
    const r = computeSelfAwarenessAnalytics(trades);
    expect(Array.isArray(r.patterns)).toBe(true);
  });

  test("performance: 1000 trades completes quickly", () => {
    const trades = Array(1000).fill(null).map((_, i) =>
      makeTrade(["Great","Average","Poor"][i % 3])
    );
    const start = Date.now();
    computeSelfAwarenessAnalytics(trades);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("performance: 10000 trades completes under 2s", () => {
    const trades = Array(10000).fill(null).map((_, i) =>
      makeTrade(["Great","Average","Poor"][i % 3])
    );
    const start = Date.now();
    computeSelfAwarenessAnalytics(trades);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
