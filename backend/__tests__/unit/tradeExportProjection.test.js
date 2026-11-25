"use strict";

// The Settings CSV export reads these fields; the slim journal projection
// used to drop them, so the downloaded spreadsheet had blank columns.
const { TRADE_EXPORT_PROJECTION } = require("../../repositories/trade.repository");

const CSV_FIELDS = [
  "pair", "type", "lotSize", "entryPrice", "exitPrice", "stopLoss", "takeProfit",
  "profit", "commission", "swap", "broker", "session", "strategy", "setup",
  "setupScore", "riskRewardRatio", "riskRewardCustom", "entryBasis", "entryBasisCustom",
  "mood", "confidence", "emotionalTags", "mistakeTag", "lesson", "wouldRetake",
  "tradeQuality", "notes", "effectiveTradeDate", "tradeDate",
];

test("Forex export projection includes every CSV column field", () => {
  const fields = new Set(TRADE_EXPORT_PROJECTION.split(/\s+/));
  for (const f of CSV_FIELDS) expect(fields.has(f)).toBe(true);
});
