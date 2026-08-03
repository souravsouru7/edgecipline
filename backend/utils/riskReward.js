"use strict";

/**
 * Planned risk/reward for a single trade.
 *
 * Two things this guards that the previous inline versions did not:
 *
 * 1. DIRECTION. A real plan puts the stop and the target on opposite sides of
 *    entry — below/above for a long, above/below for a short. The old formula
 *    was `Math.abs(target - entry) / Math.abs(entry - stop)`, which accepts both
 *    levels on the same side without complaint. A NAS100 row with entry
 *    28469.59, "stop" 28467.80 (1.79 below) and target 28338.90 (130.69 below)
 *    is not a tradeable plan, but that formula reported it as 73.01:1 — and one
 *    such row dragged a 14-trade average from 2.27 to 7.34.
 *
 * 2. PRECEDENCE. When the prices do not describe a coherent plan, fall back to
 *    the ratio the trader actually selected (`riskRewardRatio` / custom) rather
 *    than reporting a number derived from contradictory levels.
 *
 * @returns {{rr: number, risk: number|null, source: "price"|"field"}|null}
 */
function parseRiskRewardField(value) {
  if (!value || typeof value !== "string") return null;
  if (!value.includes(":")) return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const reward = parseFloat(parts[1]);
  const risk = parseFloat(parts[0]);
  if (!Number.isFinite(reward) || reward <= 0) return null;
  // "1:2" is the overwhelmingly common form; honour a non-1 left side anyway.
  if (Number.isFinite(risk) && risk > 0) return reward / risk;
  return reward;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getPlannedRiskReward(trade = {}) {
  const entry = numericOrNull(trade.entryPrice);
  const stop = numericOrNull(trade.stopLoss);
  const target = numericOrNull(trade.takeProfit);

  if (entry != null && stop != null && target != null) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    // Strictly opposite sides of entry — this is what makes it a plan rather
    // than two arbitrary levels.
    const coherent = (stop - entry) * (target - entry) < 0;
    if (coherent && risk > 0 && reward > 0) {
      return { rr: reward / risk, risk, source: "price" };
    }
  }

  const fieldRR = trade.riskRewardRatio === "custom"
    ? parseRiskRewardField(trade.riskRewardCustom)
    : parseRiskRewardField(trade.riskRewardRatio);

  return fieldRR ? { rr: fieldRR, risk: null, source: "field" } : null;
}

module.exports = { getPlannedRiskReward, parseRiskRewardField };
