"use strict";

/**
 * Unit tests for missionService helper functions.
 * Pure logic only — no DB calls.
 */

const { progressPercent, formatAssignment } = require("../../services/missionService");
const { validateTradeForMission, isMissionComplete } = require("../../services/missionProgressService");

// ─── progressPercent ──────────────────────────────────────────────────────────

describe("progressPercent", () => {
  function makeAssignment(overrides) {
    return {
      currentProgress: 0,
      percentNumerator: 0,
      percentDenominator: 0,
      missionSnapshot: { progressMode: "total_trades", target: 20 },
      ...overrides,
    };
  }

  it("returns 0 when currentProgress is 0", () => {
    expect(progressPercent(makeAssignment())).toBe(0);
  });

  it("returns 50 when half done", () => {
    expect(progressPercent(makeAssignment({ currentProgress: 10 }))).toBe(50);
  });

  it("caps at 100", () => {
    expect(progressPercent(makeAssignment({ currentProgress: 25, missionSnapshot: { progressMode: "total_trades", target: 20 } }))).toBe(100);
  });

  it("handles percentage mode", () => {
    const a = makeAssignment({
      missionSnapshot: { progressMode: "percentage", target: 20 },
      percentNumerator: 16,
      percentDenominator: 20,
    });
    expect(progressPercent(a)).toBe(80);
  });

  it("percentage mode returns 0 when denominator is 0", () => {
    const a = makeAssignment({
      missionSnapshot: { progressMode: "percentage", target: 20 },
      percentNumerator: 0,
      percentDenominator: 0,
    });
    expect(progressPercent(a)).toBe(0);
  });
});

// ─── validateTradeForMission ──────────────────────────────────────────────────

describe("validateTradeForMission — risk_per_trade", () => {
  const snapshot = { validationType: "risk_per_trade", progressMode: "consecutive_trades", target: 20, validationConfig: { riskPercentMax: 1.0 } };

  it("passes when risk is exactly at limit", () => {
    const { passed } = validateTradeForMission({ riskPercent: 1.0 }, snapshot);
    expect(passed).toBe(true);
  });

  it("passes when risk is below limit", () => {
    const { passed } = validateTradeForMission({ riskPercent: 0.5 }, snapshot);
    expect(passed).toBe(true);
  });

  it("fails when risk exceeds limit", () => {
    const { passed } = validateTradeForMission({ riskPercent: 1.5 }, snapshot);
    expect(passed).toBe(false);
  });

  it("fails when risk is missing", () => {
    const { passed } = validateTradeForMission({ riskPercent: 0 }, snapshot);
    expect(passed).toBe(false);
  });
});

describe("validateTradeForMission — stop_loss_required", () => {
  const snapshot = { validationType: "stop_loss_required", progressMode: "consecutive_trades", target: 30, validationConfig: {} };

  it("passes when stopLoss is set", () => {
    const { passed } = validateTradeForMission({ stopLoss: 1.2345 }, snapshot);
    expect(passed).toBe(true);
  });

  it("fails when stopLoss is 0", () => {
    const { passed } = validateTradeForMission({ stopLoss: 0 }, snapshot);
    expect(passed).toBe(false);
  });

  it("fails when stopLoss is null", () => {
    const { passed } = validateTradeForMission({ stopLoss: null }, snapshot);
    expect(passed).toBe(false);
  });

  it("fails when stopLoss is missing", () => {
    const { passed } = validateTradeForMission({}, snapshot);
    expect(passed).toBe(false);
  });
});

describe("validateTradeForMission — risk_reward_minimum", () => {
  const snapshot = { validationType: "risk_reward_minimum", progressMode: "total_trades", target: 20, validationConfig: { rrMin: 1.5 } };

  it("passes when RR meets minimum", () => {
    const { passed } = validateTradeForMission({ riskRewardRatio: 2.0 }, snapshot);
    expect(passed).toBe(true);
  });

  it("fails when RR is below minimum", () => {
    const { passed } = validateTradeForMission({ riskRewardRatio: 1.0 }, snapshot);
    expect(passed).toBe(false);
  });

  it("fails when RR is missing", () => {
    const { passed } = validateTradeForMission({}, snapshot);
    expect(passed).toBe(false);
  });
});

describe("validateTradeForMission — checklist_every_trade", () => {
  const snapshot = { validationType: "checklist_every_trade", progressMode: "consecutive_trades", target: 20, validationConfig: {} };

  it("passes when setupRules array is non-empty", () => {
    const { passed } = validateTradeForMission({ setupRules: ["rule1", "rule2"] }, snapshot);
    expect(passed).toBe(true);
  });

  it("fails when setupRules is empty array", () => {
    const { passed } = validateTradeForMission({ setupRules: [] }, snapshot);
    expect(passed).toBe(false);
  });

  it("fails when setupRules is missing", () => {
    const { passed } = validateTradeForMission({}, snapshot);
    expect(passed).toBe(false);
  });
});

describe("validateTradeForMission — lesson_on_loss", () => {
  const snapshot = { validationType: "lesson_on_loss", progressMode: "total_trades", target: 20, validationConfig: { requireNotes: true } };

  it("returns null for winning trades", () => {
    const { passed } = validateTradeForMission({ profit: 100, notes: "" }, snapshot);
    expect(passed).toBe(null);
  });

  it("passes for losing trade with notes", () => {
    const { passed } = validateTradeForMission({ profit: -50, notes: "I entered too early before the breakout confirmed." }, snapshot);
    expect(passed).toBe(true);
  });

  it("fails for losing trade without notes", () => {
    const { passed } = validateTradeForMission({ profit: -50, notes: "" }, snapshot);
    expect(passed).toBe(false);
  });
});

// ─── isMissionComplete ────────────────────────────────────────────────────────

describe("isMissionComplete", () => {
  it("returns true when currentProgress meets target (consecutive_trades)", () => {
    const a = {
      currentProgress: 20,
      missionSnapshot: { progressMode: "consecutive_trades", target: 20 },
    };
    expect(isMissionComplete(a)).toBe(true);
  });

  it("returns false when currentProgress is below target", () => {
    const a = {
      currentProgress: 15,
      missionSnapshot: { progressMode: "consecutive_trades", target: 20 },
    };
    expect(isMissionComplete(a)).toBe(false);
  });

  it("percentage mode: completes when percentage threshold met after target denominator", () => {
    const a = {
      currentProgress: 30,
      percentNumerator: 24,
      percentDenominator: 30,
      missionSnapshot: { progressMode: "percentage", target: 30, validationConfig: { moodPercentage: 80 } },
    };
    expect(isMissionComplete(a)).toBe(true);
  });

  it("percentage mode: does not complete when denominator not met", () => {
    const a = {
      currentProgress: 15,
      percentNumerator: 15,
      percentDenominator: 15,
      missionSnapshot: { progressMode: "percentage", target: 30, validationConfig: { moodPercentage: 80 } },
    };
    expect(isMissionComplete(a)).toBe(false);
  });

  it("percentage mode: does not complete when percentage too low", () => {
    const a = {
      currentProgress: 30,
      percentNumerator: 20,
      percentDenominator: 30,
      missionSnapshot: { progressMode: "percentage", target: 30, validationConfig: { moodPercentage: 80 } },
    };
    expect(isMissionComplete(a)).toBe(false);
  });
});
