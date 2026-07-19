"use strict";

const {
  FOREX_EDITABLE_FIELDS,
  INDIAN_EDITABLE_FIELDS,
  pickForexTradeFields,
  pickIndianTradeFields,
} = require("../../utils/tradeFieldAllowlist");
const {
  deriveForexProfit,
  deriveIndianProfit,
  trustedOcrProfitForTrade,
} = require("../../utils/tradeProfit");

describe("server-derived trade P&L", () => {
  test("client-controlled profit is absent from both editable allowlists", () => {
    expect(FOREX_EDITABLE_FIELDS).not.toContain("profit");
    expect(INDIAN_EDITABLE_FIELDS).not.toContain("profit");
    expect(pickForexTradeFields({ pair: "EURUSD", profit: 999999 }))
      .toEqual({ pair: "EURUSD" });
    expect(pickIndianTradeFields({ pair: "NIFTY", profit: 999999 }))
      .toEqual({ pair: "NIFTY" });
  });

  test("derives Forex P&L from direction, prices, lot size, and costs", () => {
    expect(deriveForexProfit({
      pair: "EURUSD",
      type: "BUY",
      entryPrice: 1.1,
      exitPrice: 1.101,
      lotSize: 0.1,
      commission: 2,
      swap: -1,
    })).toBe(7);
  });

  test("converts USD-base pair P&L from quote currency to USD", () => {
    expect(deriveForexProfit({
      pair: "USDJPY",
      type: "BUY",
      entryPrice: 150,
      exitPrice: 151,
      lotSize: 0.1,
    })).toBe(66.23);
  });

  test("does not guess a USD value for a non-USD cross", () => {
    expect(deriveForexProfit({
      pair: "EURJPY",
      type: "BUY",
      entryPrice: 160,
      exitPrice: 161,
      lotSize: 0.1,
    })).toBeNull();
  });

  test("derives Indian option P&L from lots and lot size", () => {
    expect(deriveIndianProfit({
      instrumentType: "OPTION",
      type: "SELL",
      entryPrice: 120,
      exitPrice: 100,
      quantity: 2,
      lotSize: 25,
      brokerage: 20,
      sttTaxes: 5,
    })).toBe(975);
  });

  test("derives Indian equity P&L from shares and fees", () => {
    expect(deriveIndianProfit({
      instrumentType: "EQUITY",
      type: "BUY",
      entryPrice: 100,
      exitPrice: 110,
      sharesQty: 10,
      brokerage: 5,
      sttTaxes: 2,
    })).toBe(93);
  });

  test("does not derive P&L without the required price and size inputs", () => {
    expect(deriveForexProfit({ type: "BUY", entryPrice: 1, exitPrice: 2 }))
      .toBeNull();
    expect(deriveIndianProfit({
      instrumentType: "OPTION",
      type: "BUY",
      entryPrice: 1,
      exitPrice: 2,
      quantity: 1,
    })).toBeNull();
  });

  test("accepts only a P&L value present in the server-side OCR result", () => {
    const extractedTrades = [
      { pair: "NIFTY 25000 CE", type: "BUY", profit: 520 },
      { pair: "NIFTY 25000 CE", type: "BUY", profit: -130 },
    ];

    expect(trustedOcrProfitForTrade(
      { pair: "NIFTY 25000 CE", type: "BUY", profit: -130 },
      extractedTrades
    )).toBe(-130);
    expect(trustedOcrProfitForTrade(
      { pair: "NIFTY 25000 CE", type: "BUY", profit: 999999 },
      extractedTrades
    )).toBeNull();
  });

  test("matches Indian OCR P&L by underlying, strike, and option type", () => {
    const extractedTrades = [
      { symbol: "NIFTY", strike: 24200, optionType: "CE", pnl: 1371.5 },
      { symbol: "NIFTY", strike: 24300, optionType: "PE", pnl: 968.5 },
    ];

    expect(trustedOcrProfitForTrade(
      { pair: "NIFTY 24200 CE", optionType: "CE", profit: 1371.5 },
      extractedTrades,
      0
    )).toBe(1371.5);
    expect(trustedOcrProfitForTrade(
      { pair: "NIFTY 24300 PE", optionType: "PE", profit: 968.5 },
      extractedTrades,
      1
    )).toBe(968.5);
    expect(trustedOcrProfitForTrade(
      { pair: "NIFTY 24200 CE", optionType: "CE", profit: -3900.31 },
      extractedTrades,
      0
    )).toBeNull();
  });
});
