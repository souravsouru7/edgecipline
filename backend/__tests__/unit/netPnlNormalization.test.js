"use strict";

/**
 * `trade.profit` means different things per market: Forex writes it already net
 * of commission/swap, Indian writes it gross with brokerage/STT stored beside
 * it (utils/tradeProfit.js). withNetPnL is the single place that reconciles the
 * two, so every metric engine can read `trade.profit` and get a net number.
 */

const {
  withNetPnL,
  NET_PNL_NORMALIZED,
  getNetPnL,
} = require("../../utils/metricEngine");

const indian = (over = {}) => ({
  profit: 1000,
  brokerage: 40,
  sttTaxes: 25.5,
  instrumentType: "EQUITY",
  ...over,
});

const forex = (over = {}) => ({
  profit: 250,
  commission: 7,
  swap: -2,
  ...over,
});

describe("withNetPnL — per-market P&L convention", () => {
  test("deducts brokerage and STT from an Indian trade exactly once", () => {
    const [row] = withNetPnL([indian()], "Indian_Market");
    expect(row.profit).toBe(934.5);
  });

  test("leaves a Forex trade untouched — profit is already net at save time", () => {
    const [row] = withNetPnL([forex()], "Forex");
    expect(row.profit).toBe(250);
  });

  test("does not mutate the caller's array or its rows", () => {
    const rows = [indian()];
    const before = JSON.stringify(rows);
    withNetPnL(rows, "Indian_Market");
    expect(JSON.stringify(rows)).toBe(before);
  });

  test("keeps brokerage and sttTaxes on the row so gross stays recoverable", () => {
    const [row] = withNetPnL([indian()], "Indian_Market");
    expect(row.profit + row.brokerage + row.sttTaxes).toBe(1000);
  });
});

describe("withNetPnL — idempotency", () => {
  test("re-normalising is a no-op, so charges can never be deducted twice", () => {
    const once = withNetPnL([indian()], "Indian_Market");
    const twice = withNetPnL(once, "Indian_Market");
    const thrice = withNetPnL(twice, "Indian_Market");
    expect(once[0].profit).toBe(934.5);
    expect(twice[0].profit).toBe(934.5);
    expect(thrice[0].profit).toBe(934.5);
  });

  test("an already-normalised row is returned by reference, not re-copied", () => {
    const once = withNetPnL([indian()], "Indian_Market");
    const twice = withNetPnL(once, "Indian_Market");
    expect(twice[0]).toBe(once[0]);
  });

  test("the marker is a Symbol, so it cannot leak into an API response", () => {
    const [row] = withNetPnL([indian()], "Indian_Market");
    expect(row[NET_PNL_NORMALIZED]).toBe(true);
    expect(Object.keys(row)).not.toContain("NET_PNL_NORMALIZED");
    expect(JSON.parse(JSON.stringify(row))).toEqual({
      profit: 934.5,
      brokerage: 40,
      sttTaxes: 25.5,
      instrumentType: "EQUITY",
    });
  });
});

describe("withNetPnL — unrecorded and malformed P&L", () => {
  test("a null profit stays null instead of becoming a phantom loss", () => {
    const [row] = withNetPnL([indian({ profit: null })], "Indian_Market");
    expect(row.profit).toBeNull();
  });

  test("an undefined profit is left undefined", () => {
    const row = indian();
    delete row.profit;
    const [out] = withNetPnL([row], "Indian_Market");
    expect(out.profit).toBeUndefined();
  });

  test("NaN and Infinity are treated as unrecorded, not as zero", () => {
    const [nan] = withNetPnL([indian({ profit: NaN })], "Indian_Market");
    const [inf] = withNetPnL([indian({ profit: Infinity })], "Indian_Market");
    expect(Number.isNaN(nan.profit)).toBe(true);
    expect(inf.profit).toBe(Infinity);
  });

  test("a genuine zero P&L still pays its charges", () => {
    const [row] = withNetPnL([indian({ profit: 0 })], "Indian_Market");
    expect(row.profit).toBe(-65.5);
  });

  test("missing charge fields deduct nothing rather than throwing", () => {
    const [row] = withNetPnL([{ profit: 500 }], "Indian_Market");
    expect(row.profit).toBe(500);
  });

  test("a losing trade gets more negative, never less", () => {
    const [row] = withNetPnL([indian({ profit: -1000 })], "Indian_Market");
    expect(row.profit).toBe(-1065.5);
  });
});

describe("withNetPnL — combined views resolve per row", () => {
  test("Indian rows are netted and Forex rows are not, in one array", () => {
    const [fx, inr] = withNetPnL([forex(), indian()], "combined");
    expect(fx.profit).toBe(250);
    expect(inr.profit).toBe(934.5);
  });

  test("a combined array is not mis-handled by the request-level market label", () => {
    // The bug this guards: labelling the whole request "combined" used to route
    // every row through the Forex branch, leaving Indian charges undeducted.
    const [, inr] = withNetPnL([forex(), indian()], "combined");
    expect(inr.profit).not.toBe(1000);
  });
});

describe("withNetPnL — defensive inputs", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a plain object", { profit: 1 }],
    ["a string", "trades"],
  ])("returns %s unchanged rather than throwing", (_label, input) => {
    expect(withNetPnL(input, "Indian_Market")).toBe(input);
  });

  test("null and non-object entries inside the array are passed through", () => {
    const out = withNetPnL([null, undefined, indian()], "Indian_Market");
    expect(out[0]).toBeNull();
    expect(out[1]).toBeUndefined();
    expect(out[2].profit).toBe(934.5);
  });

  test("an empty array stays empty", () => {
    expect(withNetPnL([], "Indian_Market")).toEqual([]);
  });
});

describe("withNetPnL — agrees with getNetPnL for a single trade", () => {
  test("array form and scalar form produce the same number", () => {
    const trade = indian({ profit: 4321.75, brokerage: 33.3, sttTaxes: 12.05 });
    const [row] = withNetPnL([trade], "Indian_Market");
    expect(row.profit).toBeCloseTo(getNetPnL(trade, "Indian_Market"), 10);
  });
});
