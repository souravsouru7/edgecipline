const copy = require("../../utils/mindProgressCopy");

const HOLE = /undefined|null|NaN|\{\w+\}|\[object/;

describe("mind progress copy", () => {
  it("never renders a frame with a missing slot", () => {
    // tilt_after_loss has a frame needing {minutes, instrument}; without them a
    // generic frame must be used instead of printing "undefined min".
    const text = copy.renderReason({ type: "tilt_after_loss", evidence: { count: 1 } }, "u1:2026-11-20");
    expect(text).toBe("Tilted after a loss");
    expect(text).not.toMatch(HOLE);
  });

  it("uses the trader's own specifics when present", () => {
    const text = copy.renderReason({ type: "calm_after_loss", evidence: { count: 1, walkedAway: true, instrument: "NIFTY" } }, "u1:2026-11-20");
    expect(text).toContain("NIFTY");
  });

  it("is stable for the same user and day", () => {
    const fact = { type: "revenge_down", evidence: { before: 4, after: 0 } };
    expect(copy.renderHeadline(fact, "user-a:2026-11-20")).toBe(copy.renderHeadline(fact, "user-a:2026-11-20"));
  });

  it("varies across users and days for the same facts", () => {
    const fact = { type: "revenge_down", evidence: { before: 4, after: 0 } };
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) seen.add(copy.renderHeadline(fact, `user-${i}:2026-11-2${i % 10}`));
    expect(seen.size).toBeGreaterThan(1);
    for (const line of seen) expect(line).toContain("4");
  });

  it.each([
    ["revenge_down", { before: 3, after: 1 }],
    ["tag_down", { tag: "FOMO", before: 4, after: 1 }],
    ["recovery_up", { beforeCalm: 1, beforeLosses: 4, afterCalm: 3, afterLosses: 4 }],
    ["cost_down", { before: 2140, after: 300, currency: "INR" }],
    ["plan_up", { beforePct: 40, afterPct: 86 }],
    ["tag_up", { tag: "Greed", before: 0, after: 3 }],
    ["calm_after_loss", { count: 2 }],
    ["honest_tags", { tag: "Frustrated", count: 1 }],
  ])("renders %s headline without holes", (type, evidence) => {
    const text = copy.renderHeadline({ type, evidence }, "u:2026-11-20");
    expect(text).toBeTruthy();
    expect(text).not.toMatch(HOLE);
  });

  it("formats money in the trade's own currency", () => {
    expect(copy.money(2140, "INR")).toBe("₹2,140");
    expect(copy.money(-75.6, "USD")).toBe("$76");
  });

  it("renders every win and level-up with title and body", () => {
    const wins = [
      { key: "first_report", evidence: {} },
      { key: "first_report", evidence: { journaledDays: 40, startingScore: 38, score: 61 } },
      { key: "calm_under_pressure", evidence: { losses: 4, beforeSlips: 3 } },
      { key: "zero_revenge_week", evidence: { trades: 9, revengeBefore: 2 } },
      { key: "tag_halved", evidence: { tag: "FOMO", before: 6, after: 2 } },
      { key: "cost_halved", evidence: { before: 900, after: 200, currency: "USD" } },
      { key: "plan_run_best", evidence: { days: 5, previousBest: 3 } },
      { key: "self_awareness_best", evidence: { score: 82, reviews: 12 } },
      { key: "honest_journal_20", evidence: {} },
      { key: "target_completed", evidence: { label: "No FOMO trades", cleanDays: 5 } },
      { key: "level_4", evidence: { level: 4, fromLevel: 3, startingScore: 41, score: 70 } },
    ];
    for (const w of wins) {
      const { title, body } = copy.renderWin(w);
      expect(title).toBeTruthy();
      expect(`${title} ${body}`).not.toMatch(HOLE);
    }
    expect(copy.renderWin({ key: "first_report", evidence: { journaledDays: 40, startingScore: 38, score: 61 } }).body).toContain("40");
  });

  it("micro line follows the sign of the change and never blames", () => {
    const up = copy.renderMicroLine({ delta: 2, topReason: { type: "plan_followed", evidence: {} }, seed: "u:d" });
    const down = copy.renderMicroLine({ delta: -3, topReason: { type: "revenge", evidence: { count: 1 } }, seed: "u:d" });
    expect(up).toMatch(/plan/i);
    expect(down).toMatch(/happens to everyone|right back/);
  });

  it("locked copy counts down to unlock", () => {
    expect(copy.renderLocked({ journaledDays: 0, needed: 3 }, "u")).toMatch(/first day/);
    // Days, not trades: once today is counted the line points at tomorrow.
    expect(copy.renderLocked({ journaledDays: 1, needed: 3, journaledToday: true }, "u")).toMatch(/tomorrow/);
    expect(copy.renderLocked({ journaledDays: 2, needed: 3, journaledToday: true }, "u")).toMatch(/One more day \(tomorrow\)/);
    expect(copy.renderLocked({ journaledDays: 1, needed: 3, journaledToday: false }, "u")).toBe("Journal today to make it day 2 of 3 🧠");
    expect(copy.renderAlreadyCounted({ journaledDays: 1, needed: 3 })).toMatch(/Already counted today/);
  });

  it("push copy exists for every Mind push kind", () => {
    expect(copy.renderPush("mind_report_ready").title).toBeTruthy();
    expect(copy.renderPush("mind_target", { label: "No FOMO trades", cleanDays: 4, goal: 5 }).body).toContain("4 of 5");
    expect(copy.renderPush("mind_fresh_start", { suggestion: "No FOMO trades" }, "u").body).toContain("No FOMO trades");
    expect(copy.renderPush("mind_fresh_start", {}, "u").body).not.toMatch(HOLE);
  });
});
