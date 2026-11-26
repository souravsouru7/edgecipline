const engine = require("../../utils/mindProgress");

let seq = 0;
function trade(day, o = {}) {
  seq += 1;
  const hasTime = o.hasTime !== undefined ? o.hasTime : true;
  const base = Date.parse(`${day}T${hasTime ? "10:00" : "00:00"}:00Z`);
  const tags = (o.tags || []).map((t) => t.toLowerCase());
  const tagLabels = Object.fromEntries((o.tags || []).map((t) => [t.toLowerCase(), t]));
  return {
    id: `t${seq}`,
    day,
    ts: base + (o.min || 0) * 60000,
    createdTs: o.created ?? seq,
    hasTime,
    market: o.market || "Forex",
    currency: o.market === "Indian_Market" ? "INR" : "USD",
    profit: o.p === undefined ? 50 : o.p,
    instrument: o.i || "EURUSD",
    tags,
    tagLabels,
    mistake: (o.mistake || "").toLowerCase(),
    entryBasis: o.eb || "",
    confidence: o.c || "",
    mood: o.mood ?? null,
    setupScore: o.ss ?? null,
    rules: o.rules || [],
    raw: { tradeQuality: o.q || "", setupScore: o.ss ?? null, entryBasis: o.eb || "", mood: o.mood ?? null, emotionalTags: o.tags || [], confidence: o.c || "" },
  };
}
const refl = (day, followedPlan = "yes", extra = {}) => ({ day, followedPlan, mood: null, skipped: false, ...extra });

describe("computeComponents", () => {
  it("excludes components without enough data and renormalises the rest", () => {
    const trades = [trade("2026-11-20", { tags: ["Calm"], eb: "Plan" }), trade("2026-11-21", { tags: ["Calm"], eb: "Plan" })];
    const res = engine.computeComponents(trades, []);
    expect(res.components.emotional).toBeNull(); // needs 3 psych trades
    expect(res.components.discipline).toBeNull();
    expect(res.components.recovery).toBeNull();
    expect(res.components.selfAwareness).toBeNull();
    expect(res.components.journaling).toBe(82); // 100*(0.4+0.6*(0.7*1+0.3*0))
    expect(res.raw).toBe(82); // journaling alone, not dragged down by missing parts
    expect(res.coverage).toBe(0.15);
    expect(res.missing).toEqual(expect.arrayContaining(["emotional", "discipline", "recovery", "selfAwareness"]));
  });

  it("never scores an untagged screenshot import as zero", () => {
    const trades = [1, 2, 3].map((i) => trade(`2026-11-2${i}`));
    const res = engine.computeComponents(trades, []);
    expect(res.components.journaling).toBe(40);
    expect(res.components.emotional).toBeNull();
    expect(res.raw).toBe(40);
  });

  it("scores emotional control from slips and caps a spam day's weight", () => {
    const calmSpam = Array.from({ length: 30 }, () => trade("2026-11-20", { tags: ["Calm"] }));
    const slips = [trade("2026-11-21", { tags: ["FOMO"] }), trade("2026-11-22", { eb: "Impulsive" }), trade("2026-11-23", { c: "Overconfident" })];
    const res = engine.computeComponents([...calmSpam, ...slips], []);
    // 30 calm trades on one day count as 10 trades' worth: 10 clean vs 3 slips.
    expect(res.components.emotional).toBeCloseTo(76.9, 1);
  });

  it("blends setup score and the reflection plan answer into discipline", () => {
    const trades = [trade("2026-11-20", { ss: 80 }), trade("2026-11-21", { ss: 60 }), trade("2026-11-22", { ss: 100 })];
    const res = engine.computeComponents(trades, [refl("2026-11-20", "yes"), refl("2026-11-21", "no")]);
    expect(res.components.discipline).toBe(68); // 0.6*80 + 0.4*50
  });

  it("treats a no_trades reflection as a respected plan day, ignores skipped ones", () => {
    const res = engine.computeComponents([], [refl("2026-11-20", "no_trades"), refl("2026-11-21", "yes"), refl("2026-11-22", "no", { skipped: true })]);
    expect(res.components.discipline).toBe(100);
    expect(res.components.journaling).toBe(100);
  });
});

describe("computeRecovery", () => {
  it("counts calm follow-ups, tilt follow-ups and walk-aways", () => {
    const day = "2026-11-20";
    const r = engine.computeRecovery([
      trade(day, { p: -10, min: 0 }),
      trade(day, { p: 20, min: 60, tags: ["Focused"] }), // calm
      trade(day, { p: -10, min: 120 }),
      trade(day, { p: -5, min: 180, tags: ["Revenge"] }), // tilt (revenge), then walk away
    ]);
    expect(r).toMatchObject({ losses: 3, calm: 1, tilt: 1, walkAway: 1, tiltRevenge: 1, evaluated: 2 });
  });

  it("flags a same-instrument re-entry within 15 minutes as tilt", () => {
    const day = "2026-11-20";
    const r = engine.computeRecovery([trade(day, { p: -10, min: 0, i: "NIFTY" }), trade(day, { p: 5, min: 4, i: "NIFTY" })]);
    expect(r.tilt).toBe(1);
    expect(r.tiltMinutes).toEqual([4]);
  });

  it("does not apply the timing rule to date-only trades", () => {
    const day = "2026-11-20";
    const r = engine.computeRecovery([
      trade(day, { p: -10, hasTime: false, i: "NIFTY", created: 1 }),
      trade(day, { p: 5, hasTime: false, i: "NIFTY", created: 2 }),
    ]);
    expect(r).toMatchObject({ calm: 1, tilt: 0 });
  });
});

describe("smoothScore", () => {
  it("caps a single day's drop", () => {
    expect(engine.smoothScore(70, 0, { slips: true })).toBe(66);
  });
  it("always rises on a journaling day without slips", () => {
    expect(engine.smoothScore(60, 50, { slips: false })).toBe(61);
    expect(engine.smoothScore(60, 60, { slips: false })).toBe(61);
  });
  it("can fall on a day with slips", () => {
    expect(engine.smoothScore(60, 50, { slips: true })).toBe(56.5);
  });
  it("clamps to 0..100", () => {
    expect(engine.smoothScore(100, 100, { slips: false })).toBe(100);
  });
});

describe("levels", () => {
  it("maps boundaries", () => {
    expect(engine.levelFor(29.4)).toBe(1);
    expect(engine.levelFor(29.5)).toBe(2);
    expect(engine.levelFor(70)).toBe(4);
    expect(engine.levelFor(95)).toBe(6);
  });
  it("goes up immediately but only drops below the bound minus hysteresis", () => {
    expect(engine.applyLevel(2, 50)).toBe(3);
    expect(engine.applyLevel(3, 48)).toBe(3);
    expect(engine.applyLevel(3, 47)).toBe(3);
    expect(engine.applyLevel(3, 46)).toBe(2);
  });
});

describe("apportionReasons", () => {
  const facts = engine.computeDayFacts([
    trade("2026-11-20", { p: -10, min: 0, tags: ["FOMO"] }),
    trade("2026-11-20", { p: 15, min: 60, eb: "Plan", tags: ["Calm"] }),
  ], refl("2026-11-20", "yes"));

  it.each([3, 1, 0, -2, -4])("points add up to the displayed delta (%i)", (delta) => {
    const reasons = engine.apportionReasons(facts, delta);
    expect(reasons.reduce((s, r) => s + (r.points || 0), 0)).toBe(delta);
    expect(reasons[0].sign).toBe(1); // positive first
  });

  it("explains a slip-free drop as the window shifting", () => {
    const calmFacts = engine.computeDayFacts([trade("2026-11-20", { tags: ["Calm"] })], null);
    const reasons = engine.apportionReasons(calmFacts, -1);
    expect(reasons.find((r) => r.sign < 0).type).toBe("window_shift");
  });

  it("doesn't praise walking away on a day with tilt", () => {
    const f = engine.computeDayFacts([
      trade("2026-11-20", { p: -10, min: 0 }),
      trade("2026-11-20", { p: -10, min: 5, tags: ["Revenge"] }),
    ], null);
    expect(f.find((x) => x.type === "calm_after_loss")).toBeUndefined();
    expect(f.find((x) => x.type === "revenge")).toBeDefined();
  });
});

describe("buildDailyRows", () => {
  it("unlocks on the 3rd journaled day, counting reflection-only days but not skips", () => {
    const trades = [trade("2026-11-20", { tags: ["Calm"] }), trade("2026-11-22", { tags: ["Calm"] })];
    const reflections = [refl("2026-11-21", "no_trades"), refl("2026-11-23", "yes", { skipped: true })];
    const { rows, state } = engine.buildDailyRows({ trades, reflections, fromDay: "2026-11-01", toDay: "2026-11-26" });
    expect(rows.map((r) => r.day)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(rows.map((r) => r.score === null)).toEqual([true, true, false]);
    expect(rows[2].unlockedToday).toBe(true);
    expect(rows[2].delta).toBeNull(); // the first score is a starting point, not a change
    expect(state.unlockedDay).toBe("2026-11-22");
  });

  it("holds the score on days without a journal entry (no rows, no decay)", () => {
    const trades = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-25"].map((d) => trade(d, { tags: ["Calm"], eb: "Plan" }));
    const { rows } = engine.buildDailyRows({ trades, reflections: [], fromDay: "2026-10-28", toDay: "2026-11-26" });
    expect(rows.map((r) => r.day)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-25"]);
    expect(rows[3].score).toBeGreaterThanOrEqual(rows[2].score); // slip-free day still counts up
  });

  it("continues from the previous stored state", () => {
    const trades = [trade("2026-11-25", { tags: ["FOMO"], p: -20 })];
    const { rows } = engine.buildDailyRows({
      trades, reflections: [], fromDay: "2026-11-25", toDay: "2026-11-26",
      prev: { score: 72, level: 4, journaledDays: 10, unlockedDay: "2026-10-01" },
    });
    expect(rows[0].journaledDays).toBe(11);
    expect(rows[0].score).toBeGreaterThanOrEqual(68); // max drop 4
    expect(rows[0].level).toBe(4); // 68 is inside hysteresis for level 4 (70-3=67)
  });

  it("is deterministic", () => {
    const trades = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"].map((d, i) => trade(d, { tags: [i % 2 ? "FOMO" : "Calm"], p: i % 2 ? -5 : 5 }));
    const a = engine.buildDailyRows({ trades, reflections: [], fromDay: "2026-11-01", toDay: "2026-11-26" });
    const b = engine.buildDailyRows({ trades, reflections: [], fromDay: "2026-11-01", toDay: "2026-11-26" });
    expect(a).toEqual(b);
  });

  it("rotates the headline so consecutive days don't lead with the same fact type", () => {
    const days = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"];
    const trades = days.map((d) => trade(d, { tags: ["Calm"], eb: "Plan", ss: 90 }));
    const reflections = days.map((d) => refl(d, "yes"));
    const { rows } = engine.buildDailyRows({ trades, reflections, fromDay: "2026-11-01", toDay: "2026-11-26" });
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].headlineType).not.toBe(rows[i - 1].headlineType);
    }
  });
});

describe("computeTrend", () => {
  it("claims a revenge drop only with enough data in both weeks", () => {
    const prevWeek = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"].map((d) => trade(d, { tags: ["Revenge"], p: -10 }));
    const thisWeek = ["2026-11-21", "2026-11-22", "2026-11-23"].map((d) => trade(d, { tags: ["Calm"] }));
    const { facts } = engine.computeTrend([...prevWeek, ...thisWeek], [], "2026-11-23");
    expect(facts.find((f) => f.type === "revenge_down")).toMatchObject({ evidence: { before: 4, after: 0 } });

    const thin = engine.computeTrend([...prevWeek, thisWeek[0]], [], "2026-11-23");
    expect(thin.facts.find((f) => f.type === "revenge_down")).toBeUndefined();
  });

  it("keeps emotional cost per currency (never sums $ and ₹)", () => {
    const prev = [
      trade("2026-11-10", { tags: ["FOMO"], p: -100 }), trade("2026-11-11", { tags: ["FOMO"], p: -100 }), trade("2026-11-12", { tags: ["Calm"] }),
      trade("2026-11-10", { tags: ["FOMO"], p: -5000, market: "Indian_Market" }),
    ];
    const cur = [trade("2026-11-21", { tags: ["Calm"] }), trade("2026-11-22", { tags: ["Calm"] }), trade("2026-11-23", { tags: ["FOMO"], p: -20 })];
    const { facts } = engine.computeTrend([...prev, ...cur], [], "2026-11-23");
    const costs = facts.filter((f) => f.type === "cost_down");
    expect(costs.map((c) => c.evidence.currency).sort()).toEqual(["INR", "USD"]);
    expect(costs.find((c) => c.evidence.currency === "USD").evidence).toMatchObject({ before: 200, after: 20 });
  });
});

describe("detectWins", () => {
  const run = (trades, reflections, today, baselines = {}) =>
    engine.detectWins({ trades, reflections, today, trend: engine.computeTrend(trades, reflections, today), baselines });

  it("gives a brand-new trader no baseline wins", () => {
    const trades = ["2026-11-21", "2026-11-22", "2026-11-23"].map((d) => trade(d, { tags: ["Calm"] }));
    const { wins } = run(trades, [], "2026-11-23");
    expect(wins.map((w) => w.key)).toEqual([]);
  });

  it("zero_revenge_week needs revenge in the past", () => {
    const before = [trade("2026-11-05", { tags: ["Revenge"], p: -10 })];
    const week = ["2026-11-21", "2026-11-22", "2026-11-23"].map((d) => trade(d, { tags: ["Calm"] }));
    expect(run(week, [], "2026-11-23").wins.find((w) => w.key === "zero_revenge_week")).toBeUndefined();
    expect(run([...before, ...week], [], "2026-11-23").wins.find((w) => w.key === "zero_revenge_week")).toMatchObject({ periodKey: "once" });
  });

  it("calm_under_pressure needs 3+ losses without tilt after a week with slips", () => {
    const prev = [trade("2026-11-12", { p: -5, min: 0 }), trade("2026-11-12", { p: -5, min: 30, tags: ["Revenge"] })];
    const week = ["2026-11-21", "2026-11-22", "2026-11-23"].map((d) => trade(d, { p: -10, tags: ["Calm"] }));
    const win = run([...prev, ...week], [], "2026-11-23").wins.find((w) => w.key === "calm_under_pressure");
    expect(win).toMatchObject({ periodKey: engine.isoWeekOfDay("2026-11-23"), evidence: { losses: 3 } });
  });

  it("plan_run_best must beat the trader's own previous best", () => {
    const reflections = ["2026-11-21", "2026-11-22", "2026-11-23"].map((d) => refl(d, "yes"));
    expect(run([], reflections, "2026-11-23", { bestPlanRun: 3 }).wins.find((w) => w.key === "plan_run_best")).toBeUndefined();
    const res = run([], reflections, "2026-11-23", { bestPlanRun: 2 });
    expect(res.wins.find((w) => w.key === "plan_run_best")).toMatchObject({ periodKey: "run:3" });
    expect(res.baselines.bestPlanRun).toBe(3);
  });

  it("honest journal streak counts consecutive tagged trades only", () => {
    const tagged = Array.from({ length: 20 }, (_, i) => trade("2026-11-23", { tags: ["Calm"], min: i }));
    expect(run(tagged, [], "2026-11-23").wins.find((w) => w.key === "honest_journal_20")).toBeDefined();
    const broken = [...tagged.slice(0, 19), trade("2026-11-23", { min: 99 })];
    expect(run(broken, [], "2026-11-23").wins.find((w) => w.key === "honest_journal_20")).toBeUndefined();
  });
});

describe("targets", () => {
  it("evaluates each preset per day", () => {
    const day = "2026-11-20";
    expect(engine.evaluateTargetDay("no_tag", { tag: "fomo" }, [trade(day, { tags: ["FOMO"] })])).toBe("slip");
    expect(engine.evaluateTargetDay("no_tag", { tag: "fomo" }, [trade(day, { tags: ["Calm"] })])).toBe("clean");
    expect(engine.evaluateTargetDay("no_tag", { tag: "fomo" }, [])).toBeNull();
    expect(engine.evaluateTargetDay("follow_rule", { rule: "Wait for retest" }, [trade(day, { rules: [{ label: "wait for retest ", followed: false }] })])).toBe("slip");
    expect(engine.evaluateTargetDay("follow_rule", { rule: "Wait for retest" }, [trade(day, { rules: [{ label: "Other", followed: false }] })])).toBeNull();
    expect(engine.evaluateTargetDay("stop_after_losses", { n: 2 }, [trade(day, { p: -1, min: 0 }), trade(day, { p: -1, min: 10 }), trade(day, { p: 5, min: 20 })])).toBe("slip");
    expect(engine.evaluateTargetDay("stop_after_losses", { n: 2 }, [trade(day, { p: -1, min: 0 }), trade(day, { p: -1, min: 10 })])).toBe("clean");
    expect(engine.evaluateTargetDay("tag_every_trade", {}, [trade(day, { tags: ["Calm"] }), trade(day)])).toBe("slip");
    expect(engine.evaluateTargetDay("plan_days", {}, [], refl(day, "partly"))).toBe("slip");
    expect(engine.evaluateTargetDay("plan_days", {}, [], refl(day, "no_trades"))).toBe("clean");
  });

  it("completes at the goal and expires after the window", () => {
    const target = { preset: "tag_every_trade", params: {}, startDay: "2026-11-20", endDay: "2026-11-26", goal: 5 };
    const days = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"];
    const done = engine.evaluateTarget(target, days.map((d) => trade(d, { tags: ["Calm"] })), [], "2026-11-24");
    expect(done).toMatchObject({ status: "completed", cleanDays: 5, completedDay: "2026-11-24" });

    const partial = engine.evaluateTarget(target, days.slice(0, 3).map((d) => trade(d, { tags: ["Calm"] })), [], "2026-11-27");
    expect(partial).toMatchObject({ status: "expired", cleanDays: 3 });

    const ongoing = engine.evaluateTarget(target, [trade("2026-11-20"), trade("2026-11-21", { tags: ["Calm"] })], [], "2026-11-21");
    expect(ongoing).toMatchObject({ status: "active", cleanDays: 1, activeDays: 2, dayResults: { "2026-11-20": "slip", "2026-11-21": "clean" } });
  });

  it("suggests targets from the trader's own leaks", () => {
    const trades = [
      trade("2026-11-20", { tags: ["FOMO"], rules: [{ label: "Wait for retest", followed: false }] }),
      trade("2026-11-21", { tags: ["FOMO"], rules: [{ label: "Wait for retest", followed: false }] }),
      trade("2026-11-22", { rules: [{ label: "Wait for retest", followed: true }] }),
    ];
    const s = engine.suggestTargets(trades, []);
    expect(s[0]).toMatchObject({ preset: "no_tag", params: { tag: "fomo", label: "FOMO" } });
    expect(s.find((x) => x.preset === "follow_rule")).toMatchObject({ params: { rule: "Wait for retest" } });
    expect(s.map((x) => x.preset)).toEqual(expect.arrayContaining(["tag_every_trade", "plan_days"]));
  });
});
