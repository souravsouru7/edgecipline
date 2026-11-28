const g = require("../../scripts/bench/grading");

const forexCase = (trades) => ({ marketType: "Forex", trades });

describe("benchmark grading", () => {
  it("matches broker-suffixed and spaced symbols", () => {
    expect(g.symbolsMatch("GBPUSDx", "GBPUSD")).toBe(true);
    expect(g.symbolsMatch("NIFTY 24200 CE", "NIFTY24200CE")).toBe(true);
    expect(g.symbolsMatch("EURUSD", "GBPUSD")).toBe(false);
    expect(g.symbolsMatch("TCS", "TCSX")).toBe(false);
  });

  it("uses a tight numeric tolerance", () => {
    expect(g.numbersMatch(1.0850, 1.085, "entryPrice")).toBe(true);
    expect(g.numbersMatch(1.0855, 1.085, "entryPrice")).toBe(false);
    expect(g.numbersMatch(214.832, 214.802, "exitPrice")).toBe(false);
    expect(g.numbersMatch(-46.8, -46.80, "profit")).toBe(true);
    expect(g.numbersMatch(-46.81, -46.80, "profit")).toBe(true);
  });

  it("counts an empty field as missing (safe) and a different value as silent wrong", () => {
    const truth = forexCase([{ pair: "EURUSD", type: "BUY", entryPrice: 1.085, stopLoss: 1.08, profit: 50, tradeDate: "2026-11-01" }]);
    const result = { pair: "EURUSD", type: "BUY", entryPrice: 1.0855, stopLoss: null, profit: 50, tradeDate: "2026-11-01" };
    const grade = g.gradeCase(truth, result);
    expect(grade.tally.entryPrice).toMatchObject({ wrong: 1 });
    expect(grade.tally.stopLoss).toMatchObject({ missing: 1, wrong: 0 });
    expect(grade.tally.profit).toMatchObject({ correct: 1 });
    expect(grade.silentWrong).toBe(1);
  });

  it("only grades fields the trader saved", () => {
    const grade = g.gradeCase(forexCase([{ pair: "EURUSD", profit: 50 }]), { pair: "EURUSD", profit: 50, stopLoss: 9 });
    expect(Object.keys(grade.tally).sort()).toEqual(["profit", "symbol"]);
  });

  it("pairs multi-row screenshots row by row", () => {
    const truth = forexCase([
      { pair: "GBPJPY", type: "BUY", profit: -16.82 },
      { pair: "EURUSD", type: "SELL", profit: -46 },
    ]);
    const result = { trades: [
      { pair: "EURUSD.x", type: "SELL", profit: -46 },
      { pair: "GBPJPY.x", type: "BUY", profit: -16.82 },
    ] };
    const grade = g.gradeCase(truth, result);
    expect(grade.allRowsFound).toBe(true);
    expect(grade.silentWrong).toBe(0);
  });

  it("treats a null extraction as invalid", () => {
    expect(g.gradeCase(forexCase([{ pair: "EURUSD" }]), null)).toMatchObject({ invalid: true, allRowsFound: false });
  });

  it("escalates when direction, prices and P&L disagree", () => {
    const c = forexCase([]);
    expect(g.needsEscalation(c, { pair: "EURUSD", type: "BUY", quantity: 1, entryPrice: 1.09, exitPrice: 1.08, profit: 50 })).toBe(true);
    expect(g.needsEscalation(c, { pair: "EURUSD", type: "BUY", quantity: 1, entryPrice: 1.08, exitPrice: 1.09, profit: 50 })).toBe(false);
    expect(g.needsEscalation(c, null)).toBe(true);
  });
});
