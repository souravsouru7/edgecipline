const sharp = require("sharp");
const {
  analyzeImageQuality,
  buildConfidenceReport,
  detectBroker,
  detectMarket,
  marketMismatchMessage,
  validateTradeLogic,
} = require("../../services/ocrIntelligenceService");

describe("OCR Intelligence Service", () => {
  test("rejects a low-resolution screenshot before OCR", async () => {
    const buffer = await sharp({
      create: { width: 240, height: 240, channels: 3, background: "white" },
    }).png().toBuffer();

    const result = await analyzeImageQuality(buffer);

    expect(result.acceptable).toBe(false);
    expect(result.issues).toContain("LOW_RESOLUTION");
    expect(result.warning).toMatch(/quality is poor/i);
  });

  test.each([
    ["MetaTrader 5 history", "MetaTrader 5"],
    ["Exness Trade History", "Exness"],
    ["Kite by Zerodha positions", "Zerodha"],
    ["Funding Pips account", "Funding Pips"],
  ])("detects broker from %s", (text, expected) => {
    expect(detectBroker(text)).toBe(expected);
  });

  test("detects an Indian screenshot uploaded in Forex and returns the required message", () => {
    const detection = detectMarket("ZERODHA KITE NIFTY 22500 CE NSE Qty P&L 1200");
    expect(detection.market).toBe("INDIAN");
    expect(marketMismatchMessage("Forex", detection.market)).toMatch(/Indian Market screenshot/);
  });

  test("flags impossible BUY profit direction", () => {
    const result = validateTradeLogic({
      pair: "EURUSD",
      type: "BUY",
      entryPrice: 100,
      exitPrice: 90,
      quantity: 1,
      profit: 50,
    }, "Forex");

    expect(result.isValid).toBe(false);
    expect(result.failures).toContain("BUY_PROFIT_DIRECTION_MISMATCH");
  });

  test("requires verification when trade logic is contradictory", () => {
    const report = buildConfidenceReport({
      quality: { score: 100 },
      broker: "MetaTrader 5",
      marketDetection: { market: "FOREX", requestedMarket: "Forex", matches: true },
      extractionScore: 100,
      validation: { isValid: true },
      trades: [{ pair: "EURUSD", type: "BUY", entryPrice: 100, exitPrice: 90, quantity: 1, profit: 50 }],
    });

    expect(report.score).toBeLessThan(95);
    expect(report.decision).not.toBe("AUTO_APPROVED");
  });
});
