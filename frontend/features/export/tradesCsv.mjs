// Pure CSV building for the trade export (no app imports, so it is unit-tested
// directly: features/export/tradesCsv.test.mjs).

const fmtDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const list = (v) => (Array.isArray(v) ? v.filter(Boolean).join("; ") : v ?? "");
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : v ?? "");

const COMMON_TAIL = [
  ["Session", (t) => t.session],
  ["Strategy", (t) => t.strategy],
  ["Setup", (t) => t.setup],
  ["Setup score %", (t) => t.setupScore],
  ["Risk:reward", (t) => t.riskRewardCustom || t.riskRewardRatio],
  ["Entry reason", (t) => t.entryBasisCustom || t.entryBasis],
  ["Mood (1-5)", (t) => t.mood],
  ["Confidence (1-5)", (t) => t.confidence],
  ["Emotions", (t) => list(t.emotionalTags)],
  ["Mistake", (t) => t.mistakeTag],
  ["Lesson", (t) => t.lesson],
  ["Would take again", (t) => yesNo(t.wouldRetake)],
  ["Trade quality", (t) => t.tradeQuality],
  ["Notes", (t) => t.notes],
];

const COLUMNS = {
  Forex: [
    ["Date", (t) => fmtDate(t.effectiveTradeDate || t.tradeDate)],
    ["Pair", (t) => t.pair],
    ["Direction", (t) => t.type],
    ["Lot size", (t) => t.lotSize],
    ["Entry", (t) => t.entryPrice],
    ["Exit", (t) => t.exitPrice],
    ["Stop loss", (t) => t.stopLoss],
    ["Take profit", (t) => t.takeProfit],
    ["Profit", (t) => t.profit],
    ["Commission", (t) => t.commission],
    ["Swap", (t) => t.swap],
    ["Broker", (t) => t.broker],
    ...COMMON_TAIL,
  ],
  Indian_Market: [
    ["Date", (t) => fmtDate(t.effectiveTradeDate || t.tradeDate)],
    ["Symbol", (t) => t.stockSymbol || t.pair || t.underlying],
    ["Segment", (t) => t.segment],
    ["Instrument", (t) => t.instrumentType],
    ["Option type", (t) => t.optionType],
    ["Strike", (t) => t.strikePrice],
    ["Expiry", (t) => fmtDate(t.expiryDate)],
    ["Direction", (t) => t.type],
    ["Quantity (lots)", (t) => t.quantity ?? t.sharesQty],
    ["Lot size", (t) => t.lotSize],
    ["Entry", (t) => t.entryPrice],
    ["Exit", (t) => t.exitPrice],
    ["Stop loss", (t) => t.stopLoss],
    ["Target", (t) => t.takeProfit],
    ["P&L (INR)", (t) => t.profit],
    ["Brokerage", (t) => t.brokerage],
    ["Exchange", (t) => t.exchange],
    ...COMMON_TAIL,
  ],
};

/**
 * One CSV cell. Quotes when needed, and neutralises text that a spreadsheet
 * would run as a formula (=, +, -, @ at the start), since notes and setup
 * names are free text.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function tradesToCsv(trades, market = "Forex") {
  const cols = COLUMNS[market] || COLUMNS.Forex;
  const lines = [cols.map(([h]) => csvCell(h)).join(",")];
  for (const t of trades) lines.push(cols.map(([, get]) => csvCell(get(t))).join(","));
  // BOM so Excel reads UTF-8 (₹, accented names) correctly; CRLF per RFC 4180.
  return `﻿${lines.join("\r\n")}\r\n`;
}

