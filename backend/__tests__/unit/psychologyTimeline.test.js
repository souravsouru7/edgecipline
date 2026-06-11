"use strict";

const {
  computePsychologyTimeline,
  getDayKey,
  getWeekKey,
  getMonthKey,
  computeBucketPsychologyScore,
  computeBucketSelfAwareness,
  computeBucketDiscipline,
  computeBucketEmotions,
  computeTrend,
  generateMilestones,
} = require("../../utils/psychologyTimeline");

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeTrade(overrides = {}) {
  return {
    profit: 100,
    tradeDate: new Date("2026-03-15T10:00:00Z"),
    emotionalTags: [],
    mood: 3,
    confidence: "Medium",
    setupScore: 70,
    setupRules: [{ label: "Stop loss", followed: true }],
    entryBasis: "Plan",
    wouldRetake: "Yes",
    tradeQuality: "Great",
    ...overrides,
  };
}

function makeTrades(n, overrides = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(makeTrade({
      tradeDate: new Date(`2026-0${Math.floor(i / 5) + 1 || 1}-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
      ...overrides,
    }));
  }
  return out;
}

// ── Date key helpers ───────────────────────────────────────────────────────────

describe("getDayKey", () => {
  it("formats to YYYY-MM-DD", () => {
    expect(getDayKey(new Date("2026-03-07T15:00:00Z"))).toBe("2026-03-07");
  });
  it("returns null for invalid date", () => {
    expect(getDayKey("not-a-date")).toBeNull();
  });
});

describe("getWeekKey", () => {
  it("returns ISO week key", () => {
    // 2026-01-05 is a Monday of week 2
    const result = getWeekKey(new Date("2026-01-05T00:00:00Z"));
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });
  it("groups same week together", () => {
    const mon = getWeekKey(new Date("2026-03-09T00:00:00Z"));
    const fri = getWeekKey(new Date("2026-03-13T00:00:00Z"));
    expect(mon).toBe(fri);
  });
  it("separates different weeks", () => {
    const w1 = getWeekKey(new Date("2026-03-09T00:00:00Z"));
    const w2 = getWeekKey(new Date("2026-03-16T00:00:00Z"));
    expect(w1).not.toBe(w2);
  });
  it("returns null for invalid date", () => {
    expect(getWeekKey("bad")).toBeNull();
  });
});

describe("getMonthKey", () => {
  it("formats to YYYY-MM", () => {
    expect(getMonthKey(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
  });
  it("pads single-digit month", () => {
    expect(getMonthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
  it("returns null for invalid date", () => {
    expect(getMonthKey("not-a-date")).toBeNull();
  });
});

// ── Per-bucket psychology score ────────────────────────────────────────────────

describe("computeBucketPsychologyScore", () => {
  it("returns 50 for empty trades", () => {
    expect(computeBucketPsychologyScore([])).toBe(50);
  });

  it("returns 50 for trades with no emotional tags", () => {
    const trades = [makeTrade({ profit: 200, emotionalTags: [] })];
    expect(computeBucketPsychologyScore(trades)).toBe(50);
  });

  it("lowers score for losing FOMO trades", () => {
    const trades = [makeTrade({ profit: -300, emotionalTags: ["FOMO"] })];
    const score = computeBucketPsychologyScore(trades);
    expect(score).toBeLessThan(50);
  });

  it("raises score for winning Calm trades", () => {
    const trades = [makeTrade({ profit: 300, emotionalTags: ["Calm"] })];
    const score = computeBucketPsychologyScore(trades);
    expect(score).toBeGreaterThan(50);
  });

  it("clamps to 0-100", () => {
    const allBad = Array(20).fill(null).map(() => makeTrade({ profit: -500, emotionalTags: ["FOMO", "Revenge", "Fear"] }));
    const allGood = Array(20).fill(null).map(() => makeTrade({ profit: 500, emotionalTags: ["Calm", "Focused"] }));
    expect(computeBucketPsychologyScore(allBad)).toBeGreaterThanOrEqual(0);
    expect(computeBucketPsychologyScore(allGood)).toBeLessThanOrEqual(100);
  });
});

// ── Per-bucket self-awareness ──────────────────────────────────────────────────

describe("computeBucketSelfAwareness", () => {
  it("returns null when no trades have tradeQuality", () => {
    const trades = [makeTrade({ tradeQuality: null, setupScore: null, entryBasis: null })];
    expect(computeBucketSelfAwareness(trades)).toBeNull();
  });

  it("returns 100 when all self-ratings match system evaluation", () => {
    // setupScore=100, entryBasis=Plan, mood=5, wouldRetake=Yes → system = Great
    const trades = [
      makeTrade({ tradeQuality: "Great", setupScore: 100, entryBasis: "Plan", mood: 5, wouldRetake: "Yes", confidence: "Medium", emotionalTags: [] }),
      makeTrade({ tradeQuality: "Great", setupScore: 100, entryBasis: "Plan", mood: 5, wouldRetake: "Yes", confidence: "Medium", emotionalTags: [] }),
    ];
    const score = computeBucketSelfAwareness(trades);
    expect(score).toBe(100);
  });

  it("returns 0 when no self-ratings match", () => {
    // setupScore=0, entryBasis=Impulsive, mood=1, wouldRetake=No → system = Poor
    // but user rates Great
    const trades = [
      makeTrade({ tradeQuality: "Great", setupScore: 0, entryBasis: "Impulsive", mood: 1, wouldRetake: "No", confidence: "Low", emotionalTags: ["FOMO"] }),
    ];
    const score = computeBucketSelfAwareness(trades);
    expect(score).toBe(0);
  });
});

// ── Per-bucket discipline ──────────────────────────────────────────────────────

describe("computeBucketDiscipline", () => {
  it("returns null when no discipline data", () => {
    const trades = [makeTrade({ setupScore: null, setupRules: [] })];
    expect(computeBucketDiscipline(trades)).toBeNull();
  });

  it("uses only setupScore when no rules", () => {
    const trades = [makeTrade({ setupScore: 80, setupRules: [] })];
    expect(computeBucketDiscipline(trades)).toBe(80);
  });

  it("uses only rule compliance when no setup score", () => {
    const trades = [
      makeTrade({ setupScore: null, setupRules: [{ label: "Rule 1", followed: true }] }),
      makeTrade({ setupScore: null, setupRules: [{ label: "Rule 1", followed: true }] }),
    ];
    expect(computeBucketDiscipline(trades)).toBe(100);
  });

  it("averages setup score and rule compliance", () => {
    const trades = [
      makeTrade({ setupScore: 80, setupRules: [{ label: "Rule 1", followed: true }] }),
      makeTrade({ setupScore: 80, setupRules: [{ label: "Rule 1", followed: false }] }),
    ];
    // avgSetup = 80, ruleCompliance = 50% → 0.5*80 + 0.5*50 = 65
    expect(computeBucketDiscipline(trades)).toBe(65);
  });
});

// ── Per-bucket emotions ────────────────────────────────────────────────────────

describe("computeBucketEmotions", () => {
  it("returns empty tagCosts for trades with no emotional tags", () => {
    const trades = [makeTrade({ emotionalTags: [] })];
    const { tagCosts } = computeBucketEmotions(trades);
    expect(Object.keys(tagCosts)).toHaveLength(0);
  });

  it("aggregates P&L per tag", () => {
    const trades = [
      makeTrade({ profit: -100, emotionalTags: ["FOMO"] }),
      makeTrade({ profit: -200, emotionalTags: ["FOMO"] }),
    ];
    const { tagCosts } = computeBucketEmotions(trades);
    expect(tagCosts["FOMO"].count).toBe(2);
    expect(tagCosts["FOMO"].netPnL).toBe(-300);
    expect(tagCosts["FOMO"].isNeg).toBe(true);
  });

  it("computes avgMood", () => {
    const trades = [
      makeTrade({ mood: 4 }),
      makeTrade({ mood: 2 }),
    ];
    const { avgMood } = computeBucketEmotions(trades);
    expect(avgMood).toBe(3);
  });

  it("returns null avgMood when no trades have mood", () => {
    const trades = [makeTrade({ mood: undefined })];
    const { avgMood } = computeBucketEmotions(trades);
    expect(avgMood).toBeNull();
  });
});

// ── Trend computation ──────────────────────────────────────────────────────────

describe("computeTrend", () => {
  it("returns stable for < 4 values", () => {
    expect(computeTrend([60, 65, 70])).toBe("stable");
  });

  it("detects improving trend", () => {
    expect(computeTrend([40, 50, 60, 70, 80])).toBe("improving");
  });

  it("detects declining trend", () => {
    expect(computeTrend([80, 70, 60, 50, 40])).toBe("declining");
  });

  it("returns stable for flat values", () => {
    expect(computeTrend([60, 61, 60, 59, 60, 61])).toBe("stable");
  });

  it("handles null values in array", () => {
    expect(computeTrend([null, 50, null, 70, 80, 90])).toBe("improving");
  });

  it("returns stable when all nulls", () => {
    expect(computeTrend([null, null, null, null])).toBe("stable");
  });
});

// ── Milestone generation ───────────────────────────────────────────────────────

describe("generateMilestones", () => {
  it("returns empty array for single bucket", () => {
    const buckets = [{ key: "2026-01", psychologyScore: 75, selfAwarenessScore: 85, tradeCount: 5, emotions: { tagCosts: {} } }];
    // Not enough to generate best/worst milestones (needs ≥3)
    const milestones = generateMilestones(buckets);
    // threshold milestones should still fire
    expect(milestones.some(m => m.type === "psychology_threshold")).toBe(true);
    expect(milestones.some(m => m.type === "self_awareness_threshold")).toBe(true);
  });

  it("generates psychology threshold milestone on first crossing 70", () => {
    const buckets = [
      { key: "2026-01", psychologyScore: 45, selfAwarenessScore: null, tradeCount: 3, emotions: { tagCosts: {} } },
      { key: "2026-02", psychologyScore: 72, selfAwarenessScore: null, tradeCount: 5, emotions: { tagCosts: {} } },
      { key: "2026-03", psychologyScore: 80, selfAwarenessScore: null, tradeCount: 5, emotions: { tagCosts: {} } },
    ];
    const milestones = generateMilestones(buckets);
    const psychoMilestone = milestones.find(m => m.type === "psychology_threshold");
    expect(psychoMilestone).toBeDefined();
    expect(psychoMilestone.key).toBe("2026-02");
  });

  it("generates self-awareness threshold milestone", () => {
    const buckets = [
      { key: "2026-01", psychologyScore: 50, selfAwarenessScore: 60, tradeCount: 3, emotions: { tagCosts: {} } },
      { key: "2026-02", psychologyScore: 55, selfAwarenessScore: 82, tradeCount: 5, emotions: { tagCosts: {} } },
      { key: "2026-03", psychologyScore: 60, selfAwarenessScore: 90, tradeCount: 5, emotions: { tagCosts: {} } },
    ];
    const milestones = generateMilestones(buckets);
    const awMilestone = milestones.find(m => m.type === "self_awareness_threshold");
    expect(awMilestone).toBeDefined();
    expect(awMilestone.key).toBe("2026-02");
  });

  it("generates revenge-free streak milestone when ≥4 consecutive", () => {
    const buckets = Array.from({ length: 5 }, (_, i) => ({
      key: `2026-0${i + 1}`,
      psychologyScore: 60,
      selfAwarenessScore: null,
      tradeCount: 3,
      emotions: { tagCosts: {} }, // no Revenge
    }));
    const milestones = generateMilestones(buckets);
    expect(milestones.some(m => m.type === "revenge_free_streak")).toBe(true);
  });

  it("does NOT generate revenge-free streak with < 4 consecutive", () => {
    const buckets = [
      { key: "2026-01", psychologyScore: 60, selfAwarenessScore: null, tradeCount: 2, emotions: { tagCosts: { Revenge: { count: 1 } } } },
      { key: "2026-02", psychologyScore: 60, selfAwarenessScore: null, tradeCount: 2, emotions: { tagCosts: {} } },
      { key: "2026-03", psychologyScore: 60, selfAwarenessScore: null, tradeCount: 2, emotions: { tagCosts: {} } },
    ];
    const milestones = generateMilestones(buckets);
    expect(milestones.some(m => m.type === "revenge_free_streak")).toBe(false);
  });
});

// ── Full computePsychologyTimeline ─────────────────────────────────────────────

describe("computePsychologyTimeline", () => {
  it("returns insufficient for empty trades", () => {
    const result = computePsychologyTimeline([], { period: "weekly" });
    expect(result.insufficient).toBe(true);
    expect(result.reason).toBe("no_trades");
    expect(result.buckets).toHaveLength(0);
  });

  it("returns insufficient for null/undefined", () => {
    const result = computePsychologyTimeline(null);
    expect(result.insufficient).toBe(true);
  });

  it("produces buckets for valid trades (monthly)", () => {
    const trades = [
      ...Array(5).fill(null).map(() => makeTrade({ tradeDate: new Date("2026-01-10T10:00:00Z") })),
      ...Array(5).fill(null).map(() => makeTrade({ tradeDate: new Date("2026-02-10T10:00:00Z") })),
      ...Array(5).fill(null).map(() => makeTrade({ tradeDate: new Date("2026-03-10T10:00:00Z") })),
    ];
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(result.insufficient).toBe(false);
    expect(result.buckets).toHaveLength(3);
    expect(result.buckets[0].key).toBe("2026-01");
    expect(result.buckets[1].key).toBe("2026-02");
    expect(result.buckets[2].key).toBe("2026-03");
  });

  it("includes tradeCount per bucket", () => {
    const trades = Array(8).fill(null).map(() => makeTrade({ tradeDate: new Date("2026-01-15T10:00:00Z") }));
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(result.buckets[0].tradeCount).toBe(8);
  });

  it("includes net P&L per bucket", () => {
    const trades = [
      makeTrade({ profit: 200, tradeDate: new Date("2026-01-15T10:00:00Z") }),
      makeTrade({ profit: -50, tradeDate: new Date("2026-01-20T10:00:00Z") }),
    ];
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(result.buckets[0].net).toBe(150);
  });

  it("uses weekly period by default", () => {
    const trades = Array(10).fill(null).map((_, i) => makeTrade({
      tradeDate: new Date(`2026-03-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
    }));
    const result = computePsychologyTimeline(trades);
    expect(result.period).toBe("weekly");
  });

  it("includes trends object with three keys", () => {
    const trades = Array(20).fill(null).map((_, i) => makeTrade({
      tradeDate: new Date(`2026-0${Math.floor(i / 5) + 1}-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
    }));
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(result.trends).toHaveProperty("psychology");
    expect(result.trends).toHaveProperty("selfAwareness");
    expect(result.trends).toHaveProperty("discipline");
  });

  it("includes stats with aggregate averages", () => {
    const trades = Array(15).fill(null).map((_, i) => makeTrade({
      tradeDate: new Date(`2026-0${Math.floor(i / 5) + 1}-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
    }));
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(result.stats).toHaveProperty("avgPsychologyScore");
    expect(result.stats).toHaveProperty("totalTrades", 15);
  });

  it("generates aiSummary string", () => {
    const trades = Array(10).fill(null).map((_, i) => makeTrade({
      tradeDate: new Date(`2026-0${Math.floor(i / 5) + 1}-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`),
    }));
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(typeof result.aiSummary).toBe("string");
    expect(result.aiSummary.length).toBeGreaterThan(10);
  });

  it("includes generatedAt ISO timestamp", () => {
    const trades = [makeTrade()];
    const result = computePsychologyTimeline(trades, { period: "daily" });
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("correctly applies timezone offset", () => {
    // Trade at 2026-01-01T23:30:00Z — with +5.5h offset lands on 2026-01-02
    const trade = makeTrade({ tradeDate: new Date("2026-01-01T23:30:00Z") });
    const resultUTC   = computePsychologyTimeline([trade], { period: "daily", offsetHours: 0 });
    const resultIST   = computePsychologyTimeline([trade], { period: "daily", offsetHours: 5.5 });
    expect(resultUTC.buckets[0].key).toBe("2026-01-01");
    expect(resultIST.buckets[0].key).toBe("2026-01-02");
  });

  it("returns improving trend for consistently rising psychology scores", () => {
    // Build trades that produce rising scores: healthy tags in later months
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
    const trades = [];
    months.forEach((m, idx) => {
      for (let d = 0; d < 3; d++) {
        trades.push(makeTrade({
          tradeDate: new Date(`${m}-10T10:00:00Z`),
          profit: idx >= 3 ? 300 : -200,
          emotionalTags: idx >= 3 ? ["Calm"] : ["FOMO"],
        }));
      }
    });
    const result = computePsychologyTimeline(trades, { period: "monthly" });
    expect(result.trends.psychology).toBe("improving");
  });

  it("handles daily period correctly", () => {
    const trades = [
      makeTrade({ tradeDate: new Date("2026-03-01T10:00:00Z") }),
      makeTrade({ tradeDate: new Date("2026-03-02T10:00:00Z") }),
      makeTrade({ tradeDate: new Date("2026-03-03T10:00:00Z") }),
    ];
    const result = computePsychologyTimeline(trades, { period: "daily" });
    expect(result.buckets).toHaveLength(3);
    expect(result.buckets.map(b => b.key)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  it("milestones array is always present", () => {
    const result = computePsychologyTimeline([], { period: "weekly" });
    expect(Array.isArray(result.milestones)).toBe(true);
  });

  it("marketType is preserved in output", () => {
    const result = computePsychologyTimeline([makeTrade()], { period: "monthly", marketType: "Indian_Market" });
    expect(result.marketType).toBe("Indian_Market");
  });
});
