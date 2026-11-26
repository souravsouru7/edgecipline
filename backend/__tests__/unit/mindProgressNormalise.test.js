/**
 * Trade normalisation for the Mind Score: P&L must follow the app-wide
 * convention (Forex profit is net at save time; Indian profit is gross and
 * brokerage + STT come off once), or a small gross win that is a net loss
 * would be missed by every loss-based signal.
 */
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { normaliseTrade } = require("../../services/mindProgress.service");
const engine = require("../../utils/mindProgress");

const TZ = "Asia/Kolkata";
const TODAY = "2026-11-26";
const at = (hh, mm = 0) => new Date(`2026-11-25T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
const indian = (o = {}) => ({ _id: Math.random().toString(16).slice(2), underlying: "NIFTY", pair: "NIFTY 26000 CE", effectiveTradeDate: at(10), createdAt: at(10), ...o });

describe("normaliseTrade P&L", () => {
  it("Indian: gross +50 with 80 in charges is a 30 loss", () => {
    const t = normaliseTrade(indian({ profit: 50, brokerage: 40, sttTaxes: 40 }), "Indian_Market", TZ, TODAY);
    expect(t.profit).toBe(-30);
    expect(t.raw.profit).toBe(-30);
  });

  it("Indian: no recorded profit stays null (no invented loss from charges)", () => {
    expect(normaliseTrade(indian({ profit: null, brokerage: 20, sttTaxes: 5 }), "Indian_Market", TZ, TODAY).profit).toBeNull();
    expect(normaliseTrade(indian({ brokerage: 20 }), "Indian_Market", TZ, TODAY).profit).toBeNull();
  });

  it("Indian: missing charges deduct nothing", () => {
    expect(normaliseTrade(indian({ profit: 120 }), "Indian_Market", TZ, TODAY).profit).toBe(120);
  });

  it("Forex: stored profit is already net — commission/swap are not deducted again", () => {
    const t = normaliseTrade({ _id: "f1", pair: "eurusd", profit: 40, commission: -7, swap: -2, effectiveTradeDate: at(12), createdAt: at(12) }, "Forex", TZ, TODAY);
    expect(t.profit).toBe(40);
    expect(t.instrument).toBe("EURUSD");
    expect(t.currency).toBe("USD");
  });

  it("Indian equity without an underlying uses the stock symbol", () => {
    const t = normaliseTrade(indian({ underlying: "", stockSymbol: "reliance", pair: "RELIANCE", profit: 10 }), "Indian_Market", TZ, TODAY);
    expect(t.instrument).toBe("RELIANCE");
    expect(t.currency).toBe("INR");
  });

  it("drops future-dated trades and keeps local-day + time-of-day info", () => {
    expect(normaliseTrade(indian({ profit: 5, effectiveTradeDate: new Date("2026-11-28T10:00:00+05:30") }), "Indian_Market", TZ, TODAY)).toBeNull();
    const dateOnly = normaliseTrade(indian({ profit: 5, effectiveTradeDate: new Date("2026-11-25T00:00:00+05:30") }), "Indian_Market", TZ, TODAY);
    expect(dateOnly.day).toBe("2026-11-25");
    expect(dateOnly.hasTime).toBe(false);
  });

  it("a gross-win/net-loss followed by an impulsive re-entry counts as tilt after a loss", () => {
    const loss = normaliseTrade(indian({ profit: 50, brokerage: 40, sttTaxes: 40, effectiveTradeDate: at(9, 30) }), "Indian_Market", TZ, TODAY);
    const reentry = normaliseTrade(indian({ profit: 200, entryBasis: "Impulsive", effectiveTradeDate: at(9, 40) }), "Indian_Market", TZ, TODAY);
    const r = engine.computeRecovery([loss, reentry]);
    expect(r).toMatchObject({ losses: 1, tilt: 1, calm: 0 });
  });
});
