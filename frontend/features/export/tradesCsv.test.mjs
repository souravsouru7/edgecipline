import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell, tradesToCsv } from "./tradesCsv.mjs";

test("csv cells are quoted and spreadsheet-safe", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  // Free text that a spreadsheet would run as a formula is neutralised…
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  // …but real numbers (including losses) stay numbers.
  assert.equal(csvCell(-12.5), "-12.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(Number.NaN), "");
});

test("forex export has a header row, one row per trade and an Excel BOM", () => {
  const csv = tradesToCsv(
    [{ tradeDate: "2026-10-14T12:00:00Z", pair: "EURUSD", type: "BUY", profit: -20, emotionalTags: ["Rushed", "FOMO"], notes: "+ added size", wouldRetake: false }],
    "Forex",
  );
  assert.ok(csv.startsWith("﻿Date,Pair,Direction"));
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith("2026-10-14,EURUSD,BUY"));
  assert.ok(lines[1].includes("Rushed; FOMO"));
  assert.ok(lines[1].includes("'+ added size"));
  assert.ok(lines[1].includes(",-20,"));
  assert.ok(lines[1].includes(",No,"));
});

test("indian export uses the Indian columns", () => {
  const csv = tradesToCsv([{ stockSymbol: "NIFTY", optionType: "CE", strikePrice: 24500, profit: 1500 }], "Indian_Market");
  assert.ok(csv.includes("P&L (INR)"));
  assert.ok(csv.split("\r\n")[1].startsWith(",NIFTY,"));
});
