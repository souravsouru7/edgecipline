import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLossLimitInput, parseTradeLimitInput, shouldPromptForLimits, hasAnyLimit,
} from "./riskLimits.js";

test("loss limit: blank means off", () => {
  assert.deepEqual(parseLossLimitInput(""), { value: null });
  assert.deepEqual(parseLossLimitInput("   "), { value: null });
});

test("loss limit: accepts amounts with currency symbols and commas", () => {
  assert.deepEqual(parseLossLimitInput("₹5,000"), { value: 5000 });
  assert.deepEqual(parseLossLimitInput("$200.555"), { value: 200.56 });
});

test("loss limit: rejects zero, negative, text, huge", () => {
  for (const bad of ["0", "-50", "abc", "1e12", "12abc"]) {
    assert.ok(parseLossLimitInput(bad).error, bad);
  }
});

test("trades per day: whole numbers 1–100 only", () => {
  assert.deepEqual(parseTradeLimitInput("5"), { value: 5 });
  assert.deepEqual(parseTradeLimitInput(""), { value: null });
  for (const bad of ["0", "2.5", "101", "-1", "x"]) {
    assert.ok(parseTradeLimitInput(bad).error, bad);
  }
});

test("prompt shows only when nothing is set and it was never answered", () => {
  assert.equal(shouldPromptForLimits({ dailyLossLimit: null, maxTradesPerDay: null, promptAnsweredAt: null }), true);
  assert.equal(shouldPromptForLimits({ dailyLossLimit: 100, maxTradesPerDay: null, promptAnsweredAt: null }), false);
  assert.equal(shouldPromptForLimits({ dailyLossLimit: null, maxTradesPerDay: 3, promptAnsweredAt: null }), false);
  assert.equal(shouldPromptForLimits({ dailyLossLimit: null, maxTradesPerDay: null, promptAnsweredAt: "2026-11-09" }), false);
  assert.equal(shouldPromptForLimits(undefined), false); // failed load → never prompt
});

test("hasAnyLimit", () => {
  assert.equal(hasAnyLimit({ dailyLossLimit: null, maxTradesPerDay: null }), false);
  assert.equal(hasAnyLimit({ dailyLossLimit: 1 }), true);
});
