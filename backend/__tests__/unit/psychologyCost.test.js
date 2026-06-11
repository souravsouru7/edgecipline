const { computePsychologyCost, NEGATIVE_TAGS, POSITIVE_TAGS } = require("../../utils/psychologyCost");

// ── helpers ───────────────────────────────────────────────────────────────────

const makeTrade = (overrides = {}) => ({
  profit: 100,
  emotionalTags: [],
  mistakeTag: null,
  setupRules: [],
  ...overrides,
});

const fomoLoss  = (profit = -100) => makeTrade({ emotionalTags: ["FOMO"],    profit });
const calmWin   = (profit = 100)  => makeTrade({ emotionalTags: ["Calm"],    profit });
const fearLoss  = (profit = -80)  => makeTrade({ emotionalTags: ["Fear"],    profit });
const revengeLoss = (profit = -120) => makeTrade({ emotionalTags: ["Revenge"], profit });

// ── computePsychologyCost ─────────────────────────────────────────────────────

describe("computePsychologyCost", () => {

  test("empty trades returns zero state without crashing", () => {
    const r = computePsychologyCost([]);
    expect(r.emotionalCosts).toEqual([]);
    expect(r.mistakeCosts).toEqual([]);
    expect(r.ruleViolations).toEqual([]);
    expect(r.psychologyCostScore).toBe(50);
    expect(r.topLeaks).toEqual([]);
    expect(r.totalEmotionCost).toBe(0);
    expect(r.totalMistakeCost).toBe(0);
    expect(r.totalRuleViolationCost).toBe(0);
    expect(r.trackedTrades).toBe(0);
    expect(r.totalTrades).toBe(0);
  });

  test("no psychology data (no tags, no mistakes, no rules) graceful empty", () => {
    const trades = [makeTrade({ profit: 100 }), makeTrade({ profit: -50 })];
    const r = computePsychologyCost(trades);
    expect(r.emotionalCosts).toHaveLength(0);
    expect(r.trackedTrades).toBe(0);
    expect(r.totalTrades).toBe(2);
    expect(Number.isFinite(r.psychologyCostScore)).toBe(true);
  });

  // ── Module 1: Emotional Cost ──────────────────────────────────────────────

  test("FOMO losses correctly attributed", () => {
    const trades = [fomoLoss(-200), fomoLoss(-150)];
    const r = computePsychologyCost(trades);
    const fomo = r.emotionalCosts.find(e => e.tag === "FOMO");
    expect(fomo).toBeDefined();
    expect(fomo.count).toBe(2);
    expect(fomo.netPnL).toBe(-350);
    expect(fomo.avgPnL).toBe(-175);
    expect(fomo.isNegativeBehavior).toBe(true);
  });

  test("Calm wins correctly attributed as positive", () => {
    const trades = [calmWin(200), calmWin(100)];
    const r = computePsychologyCost(trades);
    const calm = r.emotionalCosts.find(e => e.tag === "Calm");
    expect(calm).toBeDefined();
    expect(calm.netPnL).toBe(300);
    expect(calm.isNegativeBehavior).toBe(false);
  });

  test("multi-tag trade: full P&L attributed to each tag independently", () => {
    const t = makeTrade({ profit: -100, emotionalTags: ["FOMO", "Fear"] });
    const r = computePsychologyCost([t]);
    const fomo = r.emotionalCosts.find(e => e.tag === "FOMO");
    const fear = r.emotionalCosts.find(e => e.tag === "Fear");
    expect(fomo.netPnL).toBe(-100);
    expect(fear.netPnL).toBe(-100);
    expect(fomo.count).toBe(1);
    expect(fear.count).toBe(1);
  });

  test("win rate calculation: 1 win, 1 loss = 50%", () => {
    const trades = [fomoLoss(-100), makeTrade({ emotionalTags: ["FOMO"], profit: 100 })];
    const r = computePsychologyCost(trades);
    const fomo = r.emotionalCosts.find(e => e.tag === "FOMO");
    expect(fomo.winRate).toBe(50);
  });

  test("emotional costs sorted by netPnL ascending (most damaging first)", () => {
    const trades = [
      fomoLoss(-300),
      revengeLoss(-100),
      calmWin(200),
    ];
    const r = computePsychologyCost(trades);
    for (let i = 1; i < r.emotionalCosts.length; i++) {
      expect(r.emotionalCosts[i].netPnL).toBeGreaterThanOrEqual(r.emotionalCosts[i - 1].netPnL);
    }
  });

  test("only winning trades: emotional costs still compute", () => {
    const trades = [calmWin(100), calmWin(200), makeTrade({ emotionalTags: ["FOMO"], profit: 50 })];
    const r = computePsychologyCost(trades);
    expect(r.emotionalCosts.length).toBeGreaterThan(0);
    expect(r.emotionalCosts.every(e => e.netPnL >= 0)).toBe(true);
  });

  test("only losing trades: emotional costs are all negative", () => {
    const trades = [fomoLoss(-100), fearLoss(-200), revengeLoss(-150)];
    const r = computePsychologyCost(trades);
    const negCosts = r.emotionalCosts.filter(e => e.isNegativeBehavior);
    negCosts.forEach(e => expect(e.netPnL).toBeLessThan(0));
  });

  test("profitFactor: wins/|losses| per emotion", () => {
    const trades = [
      makeTrade({ emotionalTags: ["FOMO"], profit: 200 }),
      makeTrade({ emotionalTags: ["FOMO"], profit: -100 }),
    ];
    const r = computePsychologyCost(trades);
    const fomo = r.emotionalCosts.find(e => e.tag === "FOMO");
    expect(fomo.profitFactor).toBe(2);
  });

  // ── Module 2: Mistake Cost ────────────────────────────────────────────────

  test("mistakeTag costs correctly aggregated", () => {
    const trades = [
      makeTrade({ mistakeTag: "Early Entry", profit: -150 }),
      makeTrade({ mistakeTag: "Early Entry", profit: -200 }),
      makeTrade({ mistakeTag: "Late Exit",   profit: -80 }),
    ];
    const r = computePsychologyCost(trades);
    const earlyEntry = r.mistakeCosts.find(m => m.tag === "Early Entry");
    const lateExit   = r.mistakeCosts.find(m => m.tag === "Late Exit");
    expect(earlyEntry.count).toBe(2);
    expect(earlyEntry.netPnL).toBe(-350);
    expect(lateExit.count).toBe(1);
    expect(lateExit.netPnL).toBe(-80);
  });

  test("duplicate mistake tags aggregated not double-counted", () => {
    const trades = Array(5).fill(null).map(() => makeTrade({ mistakeTag: "Revenge", profit: -50 }));
    const r = computePsychologyCost(trades);
    const revenge = r.mistakeCosts.find(m => m.tag === "Revenge");
    expect(revenge.count).toBe(5);
    expect(revenge.netPnL).toBe(-250);
  });

  test("no mistake tags: mistakeCosts is empty array", () => {
    const trades = [fomoLoss(-100), calmWin(200)];
    const r = computePsychologyCost(trades);
    expect(r.mistakeCosts).toHaveLength(0);
  });

  test("mistake costs sorted by netPnL ascending", () => {
    const trades = [
      makeTrade({ mistakeTag: "A", profit: -50 }),
      makeTrade({ mistakeTag: "B", profit: -200 }),
      makeTrade({ mistakeTag: "C", profit: -10 }),
    ];
    const r = computePsychologyCost(trades);
    for (let i = 1; i < r.mistakeCosts.length; i++) {
      expect(r.mistakeCosts[i].netPnL).toBeGreaterThanOrEqual(r.mistakeCosts[i - 1].netPnL);
    }
  });

  // ── Module 3: Rule Violation Cost ────────────────────────────────────────

  test("broken rules correctly attributed", () => {
    const trades = [
      makeTrade({ profit: -100, setupRules: [{ label: "Wait For Confirmation", followed: false }, { label: "Risk 1%", followed: true }] }),
      makeTrade({ profit: -80,  setupRules: [{ label: "Wait For Confirmation", followed: false }] }),
    ];
    const r = computePsychologyCost(trades);
    const rule = r.ruleViolations.find(rv => rv.rule === "Wait For Confirmation");
    expect(rule).toBeDefined();
    expect(rule.timesBroken).toBe(2);
    expect(rule.netPnL).toBe(-180);
  });

  test("followed rules NOT attributed to violations", () => {
    const trades = [
      makeTrade({ profit: 100, setupRules: [{ label: "Risk 1%", followed: true }] }),
    ];
    const r = computePsychologyCost(trades);
    expect(r.ruleViolations).toHaveLength(0);
  });

  test("rules with empty label skipped", () => {
    const trades = [
      makeTrade({ profit: -50, setupRules: [{ label: "", followed: false }, { label: "  ", followed: false }] }),
    ];
    const r = computePsychologyCost(trades);
    expect(r.ruleViolations).toHaveLength(0);
  });

  test("no setup rules: ruleViolations is empty array", () => {
    const trades = [fomoLoss(-100)];
    const r = computePsychologyCost(trades);
    expect(r.ruleViolations).toHaveLength(0);
  });

  // ── Module 4: Psychology Cost Score ──────────────────────────────────────

  test("score is between 0 and 100", () => {
    const trades = [fomoLoss(-500), calmWin(100), revengeLoss(-200)];
    const r = computePsychologyCost(trades);
    expect(r.psychologyCostScore).toBeGreaterThanOrEqual(0);
    expect(r.psychologyCostScore).toBeLessThanOrEqual(100);
  });

  test("all calm wins: score higher than all FOMO losses", () => {
    const calmTrades  = Array(5).fill(null).map(() => calmWin(100));
    const fomoTrades  = Array(5).fill(null).map(() => fomoLoss(-100));
    const calmScore   = computePsychologyCost(calmTrades).psychologyCostScore;
    const fomoScore   = computePsychologyCost(fomoTrades).psychologyCostScore;
    expect(calmScore).toBeGreaterThan(fomoScore);
  });

  test("score is 50 for neutral trades (no emotional tags)", () => {
    const trades = [makeTrade({ profit: 100 }), makeTrade({ profit: -100 })];
    const r = computePsychologyCost(trades);
    expect(r.psychologyCostScore).toBe(50);
  });

  test("no NaN or Infinity in score", () => {
    const r = computePsychologyCost([makeTrade({ profit: 0 })]);
    expect(Number.isNaN(r.psychologyCostScore)).toBe(false);
    expect(Number.isFinite(r.psychologyCostScore)).toBe(true);
  });

  // ── Module 5: Leak Detection ──────────────────────────────────────────────

  test("topLeaks contains at most 3 items", () => {
    const trades = [
      fomoLoss(-400),
      fearLoss(-300),
      revengeLoss(-200),
      makeTrade({ mistakeTag: "Early Entry", profit: -150 }),
    ];
    const r = computePsychologyCost(trades);
    expect(r.topLeaks.length).toBeLessThanOrEqual(3);
  });

  test("topLeaks sorted by cost ascending (most negative first)", () => {
    const trades = [fomoLoss(-400), fearLoss(-100), revengeLoss(-200)];
    const r = computePsychologyCost(trades);
    for (let i = 1; i < r.topLeaks.length; i++) {
      expect(r.topLeaks[i].cost).toBeGreaterThanOrEqual(r.topLeaks[i - 1].cost);
    }
  });

  test("topLeaks impactPct is valid percentage 0-100", () => {
    const trades = [fomoLoss(-200), revengeLoss(-100)];
    const r = computePsychologyCost(trades);
    r.topLeaks.forEach(leak => {
      expect(leak.impactPct).toBeGreaterThanOrEqual(0);
      expect(leak.impactPct).toBeLessThanOrEqual(100);
    });
  });

  test("topLeaks empty when no negative P&L psychology", () => {
    const trades = [calmWin(100), calmWin(200)];
    const r = computePsychologyCost(trades);
    expect(r.topLeaks).toHaveLength(0);
  });

  // ── Behavioral DNA ────────────────────────────────────────────────────────

  test("mostExpensiveEmotion is the emotion with lowest netPnL", () => {
    const trades = [fomoLoss(-300), fearLoss(-100), revengeLoss(-200)];
    const r = computePsychologyCost(trades);
    expect(r.behavioralDNA.mostExpensiveEmotion?.name).toBe("FOMO");
    expect(r.behavioralDNA.mostExpensiveEmotion?.cost).toBe(-300);
  });

  test("mostProfitableEmotion is the positive tag with highest netPnL", () => {
    const trades = [calmWin(500), makeTrade({ emotionalTags: ["Focused"], profit: 200 })];
    const r = computePsychologyCost(trades);
    expect(r.behavioralDNA.mostProfitableEmotion?.name).toBe("Calm");
  });

  test("mostExpensiveMistake identified correctly", () => {
    const trades = [
      makeTrade({ mistakeTag: "Late Exit",   profit: -50 }),
      makeTrade({ mistakeTag: "Early Entry", profit: -200 }),
    ];
    const r = computePsychologyCost(trades);
    expect(r.behavioralDNA.mostExpensiveMistake?.name).toBe("Early Entry");
  });

  test("DNA nulls gracefully when no data", () => {
    const r = computePsychologyCost([makeTrade({ profit: 50 })]);
    expect(r.behavioralDNA.mostExpensiveEmotion).toBeNull();
    expect(r.behavioralDNA.mostProfitableEmotion).toBeNull();
    expect(r.behavioralDNA.mostExpensiveMistake).toBeNull();
  });

  // ── Edge Cases ────────────────────────────────────────────────────────────

  test("null profit treated as 0, no crash", () => {
    const trades = [makeTrade({ profit: null, emotionalTags: ["FOMO"] })];
    expect(() => computePsychologyCost(trades)).not.toThrow();
    const fomo = computePsychologyCost(trades).emotionalCosts.find(e => e.tag === "FOMO");
    expect(fomo.netPnL).toBe(0);
  });

  test("undefined emotionalTags skipped gracefully", () => {
    const trades = [makeTrade({ emotionalTags: undefined, profit: 50 })];
    expect(() => computePsychologyCost(trades)).not.toThrow();
  });

  test("deleted/historical trades without psychology data excluded from trackedTrades", () => {
    const trades = [
      makeTrade({ profit: 100 }),                          // no psychology
      fomoLoss(-100),                                       // has tag
      makeTrade({ mistakeTag: "Late Exit", profit: -50 }), // has mistake
    ];
    const r = computePsychologyCost(trades);
    expect(r.trackedTrades).toBe(2);
    expect(r.totalTrades).toBe(3);
  });

  test("trackedTrades includes trades with broken rules even if no tags", () => {
    const trades = [
      makeTrade({ profit: -50, setupRules: [{ label: "Rule A", followed: false }] }),
    ];
    const r = computePsychologyCost(trades);
    expect(r.trackedTrades).toBe(1);
  });

  test("trades with zero P&L not counted as wins or losses", () => {
    const trades = [makeTrade({ profit: 0, emotionalTags: ["FOMO"] })];
    const r = computePsychologyCost(trades);
    const fomo = r.emotionalCosts.find(e => e.tag === "FOMO");
    expect(fomo.wins).toBe(0);
    expect(fomo.losses).toBe(0);
  });

  // ── Performance ───────────────────────────────────────────────────────────

  test("100 trades: completes instantly", () => {
    const trades = Array(100).fill(null).map((_, i) => fomoLoss(-(i + 1)));
    const start = Date.now();
    computePsychologyCost(trades);
    expect(Date.now() - start).toBeLessThan(100);
  });

  test("1000 trades: under 200ms", () => {
    const emotions = ["FOMO", "Revenge", "Fear", "Calm", "Focused"];
    const trades = Array(1000).fill(null).map((_, i) => makeTrade({
      profit: i % 3 === 0 ? 100 : -100,
      emotionalTags: [emotions[i % emotions.length]],
      mistakeTag: i % 5 === 0 ? "Early Entry" : null,
    }));
    const start = Date.now();
    computePsychologyCost(trades);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("10000 trades: under 1000ms", () => {
    const trades = Array(10000).fill(null).map((_, i) => makeTrade({
      profit: i % 2 === 0 ? 50 : -50,
      emotionalTags: ["FOMO"],
      setupRules: [{ label: "Rule", followed: i % 3 === 0 ? false : true }],
    }));
    const start = Date.now();
    computePsychologyCost(trades);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  // ── NEGATIVE_TAGS / POSITIVE_TAGS exports ─────────────────────────────────

  test("NEGATIVE_TAGS and POSITIVE_TAGS are non-empty arrays", () => {
    expect(Array.isArray(NEGATIVE_TAGS)).toBe(true);
    expect(NEGATIVE_TAGS.length).toBeGreaterThan(0);
    expect(Array.isArray(POSITIVE_TAGS)).toBe(true);
    expect(POSITIVE_TAGS.length).toBeGreaterThan(0);
  });

  test("NEGATIVE_TAGS and POSITIVE_TAGS have no overlap", () => {
    const posSet = new Set(POSITIVE_TAGS);
    expect(NEGATIVE_TAGS.every(t => !posSet.has(t))).toBe(true);
  });
});
