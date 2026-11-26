import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseNumericField, sanitizeNumericField } from "./numericInput.js";
import { checkForexPnl, parseRiskReward, riskRewardPayload, validateTradeRules } from "./tradeValidation.js";
import { deriveForexProfit, deriveIndianProfit, isForexPricable } from "./tradeProfit.js";

const require = createRequire(import.meta.url);
const backendProfit = require("../../../../backend/utils/tradeProfit.js");
const backendRules = require("../../../../backend/utils/tradeValidation.js");

// ── Typing: letters never get into a number box ─────────────────────────────
test("number boxes drop letters as they are typed or pasted", () => {
  assert.equal(sanitizeNumericField("riskRewardCustom", "ssd"), "");
  assert.equal(sanitizeNumericField("riskRewardCustom", "1:2.5x"), "1:2.5");
  assert.equal(sanitizeNumericField("riskRewardCustom", "1/2:3"), "1:23");
  assert.equal(sanitizeNumericField("entryPrice", "39oo.5"), "39.5");
  assert.equal(sanitizeNumericField("lotSize", "0.0a4"), "0.04");
  assert.equal(sanitizeNumericField("quantity", "3.5"), "35");
  assert.equal(sanitizeNumericField("stopLoss", "-12"), "12");
  assert.equal(sanitizeNumericField("profit", "-12a"), "-12");
  assert.equal(sanitizeNumericField("swap", "-1.5b"), "-1.5");
  assert.equal(sanitizeNumericField("notes", "abc 123"), "abc 123");
});

test("strict number parsing", () => {
  assert.equal(parseNumericField("1.2abc"), undefined);
  assert.equal(parseNumericField("1,200.5"), 1200.5);
  assert.equal(parseNumericField(""), undefined);
  assert.equal(parseNumericField("-3"), -3);
  assert.equal(parseNumericField(7), 7);
});

// ── R:R ─────────────────────────────────────────────────────────────────────
test("R:R parser matches the server exactly", () => {
  for (const input of ["ssd", "1:2.5", "2.5", "1 / 3", "1:0", "0:2", "abc:2", "1:200", "1:2.555", "", "1.50:3"]) {
    assert.deepEqual(parseRiskReward(input), backendRules.parseRiskReward(input), input);
  }
});

test("custom text is only sent when custom is selected", () => {
  assert.deepEqual(riskRewardPayload("1:2", "ssd"), { riskRewardRatio: "1:2", riskRewardCustom: "" });
  assert.deepEqual(riskRewardPayload("custom", "2.5"), { riskRewardRatio: "custom", riskRewardCustom: "1:2.5" });
  assert.deepEqual(riskRewardPayload("", ""), { riskRewardRatio: "", riskRewardCustom: "" });
});

// ── Shared rules ────────────────────────────────────────────────────────────
const forex = { pair: "XAUUSD", type: "BUY", entryPrice: "3900.07", exitPrice: "3919.47", lotSize: "0.04", riskRewardRatio: "1:2" };

test("the screenshot case: custom R:R 'ssd' is blocked", () => {
  const p = validateTradeRules({ ...forex, riskRewardRatio: "custom", riskRewardCustom: "ssd" }, { market: "Forex" });
  assert.equal(p.field, "riskRewardCustom");
});

test("take profit side: wrong side blocked, trailed stop allowed", () => {
  assert.equal(validateTradeRules({ ...forex, takeProfit: "3890" }).field, "takeProfit");
  assert.equal(validateTradeRules({ ...forex, type: "SELL", takeProfit: "3950" }).field, "takeProfit");
  assert.equal(validateTradeRules({ ...forex, stopLoss: "3905", takeProfit: "3950" }), null);
  assert.equal(validateTradeRules({ ...forex, stopLoss: "3950", takeProfit: "3950" }).field, "takeProfit");
});

test("custom entry basis, expiry, charges, sizes, text limits", () => {
  assert.equal(validateTradeRules({ ...forex, entryBasis: "Custom", entryBasisCustom: "x" }).field, "entryBasisCustom");
  const opt = { type: "BUY", entryPrice: "100", exitPrice: "120", quantity: "1", tradeDate: "2026-11-25", riskRewardRatio: "1:2" };
  assert.equal(validateTradeRules({ ...opt, expiryDate: "2026-11-20" }, { market: "Indian_Market", instrumentType: "OPTION" }).field, "expiryDate");
  assert.equal(validateTradeRules({ ...opt, expiryDate: "2026-11-27" }, { market: "Indian_Market", instrumentType: "OPTION" }), null);
  // Charges are charges whatever their printed sign (server stores |x|).
  assert.equal(validateTradeRules({ ...opt, expiryDate: "2026-11-27", brokerage: "-5" }, { market: "Indian_Market" }), null);
  assert.equal(validateTradeRules({ ...forex, lotSize: "0" }).field, "lotSize");
  assert.equal(validateTradeRules({ ...forex, lotSize: "5000" }).field, "lotSize");
  assert.equal(validateTradeRules({ ...forex, notes: "x".repeat(2001) }).field, "notes");
});

test("Forex symbols the server can't price are caught unless P&L comes from a screenshot", () => {
  assert.equal(validateTradeRules({ ...forex, pair: "BTCUSD" }).field, "pair");
  assert.equal(validateTradeRules({ ...forex, pair: "GBPJPY" }).field, "pair");
  assert.equal(validateTradeRules({ ...forex, pair: "GBPJPY" }, { hasTrustedPnl: true }), null);
  assert.equal(isForexPricable("EUR/USD"), true);
  assert.equal(isForexPricable("USDJPY"), true);
});

// ── P&L parity with the server ──────────────────────────────────────────────
test("Forex P&L equals the server's", () => {
  const cases = [
    forex,
    { ...forex, type: "SELL" },
    { pair: "EURUSD", type: "BUY", entryPrice: 1.085, exitPrice: 1.092, lotSize: 0.1, commission: -7, swap: -1.2 },
    { pair: "USDJPY", type: "SELL", entryPrice: 150.2, exitPrice: 149.8, lotSize: 1 },
    { pair: "XAGUSD", type: "BUY", entryPrice: 30, exitPrice: 31, lotSize: 0.5 },
    { pair: "GBPJPY", type: "BUY", entryPrice: 190, exitPrice: 191, lotSize: 1 },
    { pair: "BTCUSD", type: "BUY", entryPrice: 1, exitPrice: 2, lotSize: 1 },
    { pair: "EURUSD", type: "BUY", entryPrice: 1, exitPrice: 2, lotSize: 0 },
  ];
  for (const c of cases) assert.equal(deriveForexProfit(c), backendProfit.deriveForexProfit(c), JSON.stringify(c));
  assert.equal(deriveForexProfit(forex), 77.6);
});

test("Indian P&L equals the server's", () => {
  const cases = [
    { type: "BUY", entryPrice: 100, exitPrice: 120, quantity: 2, lotSize: 75 },
    { type: "SELL", entryPrice: 100, exitPrice: 120, quantity: 1, lotSize: 30 },
    { type: "BUY", instrumentType: "EQUITY", entryPrice: 2450.5, exitPrice: 2510, sharesQty: 10 },
    { type: "BUY", entryPrice: 100, exitPrice: 120, quantity: 0, lotSize: 75 },
  ];
  for (const c of cases) assert.equal(deriveIndianProfit(c), backendProfit.deriveIndianProfit(c), JSON.stringify(c));
});

// ── Screenshot review regressions ──────────────────────────────────────────
const mt5 = {
  pair: "XAUUSD.X", action: "buy", type: "buy", entryPrice: "3900.07", exitPrice: "3919.47", lotSize: "0.04",
  commission: "-0.20", profit: "71.6", stopLoss: "3884", takeProfit: "3900.68", riskRewardRatio: "custom", riskRewardCustom: "1:1.5",
};

test("MT5 screenshot trade with commission -0.20 saves (no hidden-field error)", () => {
  assert.equal(validateTradeRules(mt5, { hasTrustedPnl: true }), null);
});

test("a rule never reports a field the form doesn't show", () => {
  const bad = { ...mt5, takeProfit: "3800" };
  assert.equal(validateTradeRules(bad, { hasTrustedPnl: true }).field, "takeProfit");
  assert.equal(validateTradeRules(bad, { hasTrustedPnl: true, fields: ["pair", "entryPrice"] }), null);
});

test("screenshot P&L check catches a misread digit", () => {
  assert.deepEqual(checkForexPnl(mt5), { calculated: 77.4, differs: true });
  assert.deepEqual(checkForexPnl({ ...mt5, profit: "77.40" }), { calculated: 77.4, differs: false });
  assert.equal(checkForexPnl({ ...mt5, pair: "BTCUSD" }), null);
});

test("symbol boxes take letters, digits and / . _ - & only, uppercased", () => {
  assert.equal(sanitizeNumericField("pair", "xau@usd!.x"), "XAUUSD.X");
  assert.equal(sanitizeNumericField("pair", "eur/usd"), "EUR/USD");
  assert.equal(sanitizeNumericField("stockSymbol", "m&m"), "M&M");
  assert.equal(sanitizeNumericField("pair", "NIFTY  26000 ce"), "NIFTY 26000 CE");
  assert.equal(sanitizeNumericField("commission", "-0.20"), "-0.20");
  assert.equal(sanitizeNumericField("brokerage", "-20a"), "-20");
});
