import test from "node:test";
import assert from "node:assert/strict";
import { getDemoExtraction, INDIAN_DEMO_BROKER } from "./demoExtractionFixtures.mjs";

// The whole point of these fixtures: a demo run must never reference a stored
// asset. An http(s) imageUrl would mean the screenshot came back from Cloudinary,
// i.e. the upload we removed is back.
test("demo screenshots are bundled assets, never remote storage URLs", () => {
  for (const market of ["Forex", "Indian_Market"]) {
    const { imageUrl } = getDemoExtraction(market);
    assert.ok(imageUrl.startsWith("/"), `${market} imageUrl should be a /public path`);
    assert.doesNotMatch(imageUrl, /^https?:/i, `${market} imageUrl must not be remote`);
  }
});

test("forex demo yields the single USDCHF position from sample.png", () => {
  const payload = getDemoExtraction("Forex");
  assert.equal(payload.imageUrl, "/sample.png");
  assert.equal(payload.detectedMarket, "Forex");
  assert.equal(payload.parsedData.parsedTrades.length, 0);

  const trade = payload.parsedData.parsedTrade;
  assert.equal(trade.pair, "USDCHF");
  assert.equal(trade.action, "sell");
  assert.equal(trade.lotSize, 0.55);
  assert.equal(trade.entryPrice, 0.78195);
  assert.equal(trade.exitPrice, 0.78277);
  assert.equal(trade.stopLoss, 0.78268);
  assert.equal(trade.takeProfit, 0.78057);
  assert.equal(trade.profit, -57.62);
  assert.equal(trade.commission, -2.2);
});

test("indian demo yields both closed Upstox positions from the sample", () => {
  const payload = getDemoExtraction("Indian_Market");
  assert.equal(payload.imageUrl, "/sample_indianmarket.jpeg");
  assert.equal(payload.detectedMarket, "Indian_Market");
  assert.equal(payload.brokerType, INDIAN_DEMO_BROKER);
  assert.equal(payload.tradeSubType, "OPTION");

  const rows = payload.parsedData.parsedTrades;
  assert.equal(rows.length, 2, "multi-trade UI needs both rows");
  assert.deepEqual(
    rows.map((r) => [r.symbol, r.strike, r.optionType, r.pnl]),
    [
      ["NIFTY", "24100", "PE", 1127.75],
      ["SENSEX", "77200", "PE", 3087],
    ]
  );

  // Both rows show "0.00 Avg." — the 202.35 / 385.45 figures on screen are LTP,
  // not exit fills, so these must stay absent and save on P&L alone.
  for (const row of rows) {
    assert.equal(row.entryPrice, undefined);
    assert.equal(row.exitPrice, undefined);
  }
});

test("unknown market falls back to the forex fixture", () => {
  assert.equal(getDemoExtraction(undefined).imageUrl, "/sample.png");
  assert.equal(getDemoExtraction("Nonsense").imageUrl, "/sample.png");
});

// applyProcessedTradeData feeds these straight into React state and a demo can
// be re-run, so callers must not share mutable structure.
test("each call returns an independent deep copy", () => {
  const first = getDemoExtraction("Indian_Market");
  first.parsedData.parsedTrades[0].pnl = 999;
  first.parsedData.parsedTrades.pop();

  const second = getDemoExtraction("Indian_Market");
  assert.equal(second.parsedData.parsedTrades.length, 2);
  assert.equal(second.parsedData.parsedTrades[0].pnl, 1127.75);
});
