const { parseForexTradesFromOCR } = require("../../services/parsingService");

describe("Forex OCR parsing", () => {
  it("extracts MT5 history rows with dates and row-level P&L", () => {
    const text = `
Profit: -62.82
Deposit 0.00
Swap: 0.00
Commission: -6.50
Balance: -69.32
GBPJPY.x, buy 0.90
214.832 -> 214.802
2026.06.11 10:55:40
-16.82
#16008107
S / L: 214.753
T / P: 215.015
Open:
2026.06.11 10:42:31
Swap:
0.00
Commission:
-4.50
EURUSD.x, sell 0.40
1.15315 -> 1.15430
2026.06.11 15:55:34
-46.00
#16195223
S / L: 1.15427
T / P: 1.15050
Open:
2026.06.11 15:44:35
Swap:
0.00
Commission:
-2.00
`;

    expect(parseForexTradesFromOCR(text)).toEqual([
      expect.objectContaining({
        pair: "GBPJPY.X",
        action: "buy",
        lotSize: 0.9,
        entryPrice: 214.832,
        exitPrice: 214.802,
        profit: -16.82,
        stopLoss: 214.753,
        takeProfit: 215.015,
        tradeDate: "2026-06-11",
        commission: -4.5,
        swap: 0,
      }),
      expect.objectContaining({
        pair: "EURUSD.X",
        action: "sell",
        lotSize: 0.4,
        entryPrice: 1.15315,
        exitPrice: 1.1543,
        profit: -46,
        stopLoss: 1.15427,
        takeProfit: 1.1505,
        tradeDate: "2026-06-11",
        commission: -2,
        swap: 0,
      }),
    ]);
  });
});
