"use strict";

// Field-level grading of an extraction against the trader's saved values.
// Pure functions; unit-tested in __tests__/unit/benchGrading.test.js.

const { validateExtractedTrade, validateIndianTrade } = require("../../services/extractionQualityService");

// Fields where a confident wrong value is the worst outcome: the trader may
// not notice it on the review screen.
const CRITICAL_FIELDS = ["symbol", "type", "entryPrice", "stopLoss", "takeProfit", "tradeDate"];

const FIELD_MAP = {
  Forex: ["symbol", "type", "quantity", "entryPrice", "exitPrice", "stopLoss", "takeProfit", "profit", "tradeDate"],
  OPTION: ["symbol", "optionType", "strikePrice", "quantity", "entryPrice", "exitPrice", "stopLoss", "takeProfit", "profit"],
  EQUITY: ["symbol", "type", "entryPrice", "exitPrice", "profit"],
};

function normSymbol(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function symbolOf(t = {}) {
  return t.stockSymbol || t.pair || t.symbol || "";
}

// "GBPUSD" vs "GBPUSDx", "NIFTY 24200 CE" vs "NIFTY24200CE".
function symbolsMatch(a, b) {
  const x = normSymbol(a);
  const y = normSymbol(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 6 && (x.startsWith(y) || y.startsWith(x)));
}

// Money (P&L, commission) may differ by a rounding cent. Prices must match to
// the precision shown: 1.0855 vs 1.085 is a 5-pip error, not a match.
const MONEY_FIELDS = new Set(["profit", "commission", "swap"]);

function numbersMatch(actual, expected, field = "") {
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const tol = MONEY_FIELDS.has(field)
    ? Math.max(0.011, Math.abs(expected) * 1e-4)
    : Math.max(1e-9, Math.abs(expected) * 1e-5);
  return Math.abs(actual - expected) <= tol;
}

function fieldValue(t, field) {
  if (field === "symbol") return symbolOf(t);
  return t?.[field] ?? null;
}

function fieldMatches(field, actual, expected) {
  if (field === "symbol") return symbolsMatch(actual, expected);
  if (field === "type" || field === "optionType") return String(actual || "").toUpperCase() === String(expected || "").toUpperCase();
  if (field === "tradeDate") return String(actual || "").slice(0, 10) === String(expected || "").slice(0, 10);
  return numbersMatch(Number(actual), Number(expected), field);
}

function rowsOf(result) {
  if (!result) return [];
  if (Array.isArray(result.trades) && result.trades.length) return result.trades;
  return [result];
}

// Pairs each saved trade with the extracted row that agrees with it most.
function matchRows(expectedTrades, extractedRows, fields) {
  const used = new Set();
  return expectedTrades.map((exp) => {
    let best = null;
    let bestScore = -1;
    extractedRows.forEach((row, i) => {
      if (used.has(i)) return;
      let score = 0;
      for (const f of fields) {
        const e = fieldValue(exp, f);
        if (e == null) continue;
        if (fieldMatches(f, fieldValue(row, f), e)) score += f === "symbol" ? 3 : 1;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best != null) used.add(best);
    return { expected: exp, actual: best != null ? extractedRows[best] : null };
  });
}

/**
 * Grades one case. Returns per-field tallies:
 *   correct  - extracted and equal to the saved value
 *   missing  - left empty (the trader is asked to fill it: safe)
 *   wrong    - extracted but different (silent if the field is critical)
 * Only fields the trader actually saved are graded.
 */
function gradeCase(testCase, result) {
  const kind = testCase.marketType === "Forex" ? "Forex" : testCase.tradeSubType === "EQUITY" ? "EQUITY" : "OPTION";
  const fields = FIELD_MAP[kind];
  const pairs = matchRows(testCase.trades, rowsOf(result), fields);
  const tally = {};
  let silentWrong = 0;
  const wrongDetails = [];
  for (const { expected, actual } of pairs) {
    for (const f of fields) {
      const e = fieldValue(expected, f);
      if (e == null || e === "") continue;
      tally[f] = tally[f] || { graded: 0, correct: 0, missing: 0, wrong: 0 };
      tally[f].graded += 1;
      const a = actual ? fieldValue(actual, f) : null;
      if (a == null || a === "") tally[f].missing += 1;
      else if (fieldMatches(f, a, e)) tally[f].correct += 1;
      else {
        tally[f].wrong += 1;
        if (CRITICAL_FIELDS.includes(f)) silentWrong += 1;
        wrongDetails.push({ field: f, expected: e, actual: a });
      }
    }
  }
  const allRowsFound = pairs.every((p) => p.actual && symbolsMatch(symbolOf(p.actual), symbolOf(p.expected)));
  return { kind, tally, silentWrong, allRowsFound, extractedRows: rowsOf(result).length, invalid: !result, wrongDetails };
}

// The pipeline's own checks, used to decide whether a cheap model's answer
// should be escalated to the stronger model. Never looks at ground truth.
function needsEscalation(testCase, result) {
  const rows = rowsOf(result);
  if (!rows.length) return true;
  if (testCase.marketType === "Indian_Market") {
    return rows.some((r) => !validateIndianTrade({ ...r, pair: r.pair || r.stockSymbol }).isValid);
  }
  return rows.some((r) => {
    if (!validateExtractedTrade(r).isValid) return true;
    // Direction / price / P&L must agree with each other.
    const { type, entryPrice, exitPrice, profit } = r;
    if (type && entryPrice > 0 && exitPrice > 0 && typeof profit === "number" && Math.abs(profit) > 0) {
      const move = (exitPrice - entryPrice) * (type === "SELL" ? -1 : 1);
      if (move !== 0 && Math.sign(move) !== Math.sign(profit)) return true;
    }
    return false;
  });
}

module.exports = { CRITICAL_FIELDS, FIELD_MAP, gradeCase, matchRows, needsEscalation, numbersMatch, rowsOf, symbolsMatch };
