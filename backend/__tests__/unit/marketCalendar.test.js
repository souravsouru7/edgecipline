const calendar = require("../../utils/marketCalendar");

// 2026-09-19 = Saturday, 2026-09-20 = Sunday, 2026-09-21 = Monday,
// 2026-09-25 = Friday, 2026-10-02 = Friday (Gandhi Jayanti, NSE closed).
const at = (iso) => new Date(iso);

describe("marketCalendar", () => {
  afterEach(() => {
    delete process.env.INDIAN_MARKET_HOLIDAYS;
  });

  describe("Forex", () => {
    it.each([
      ["Monday 12:45 IST", "2026-09-21T07:15:00.000Z", true, null],
      ["Friday 18:15 IST", "2026-09-25T12:45:00.000Z", true, null],
      ["Saturday 12:45 IST", "2026-09-19T07:15:00.000Z", false, "WEEKEND"],
      ["Sunday 18:15 IST", "2026-09-20T12:45:00.000Z", false, "WEEKEND"],
    ])("%s → open=%s", (_label, iso, open, reason) => {
      expect(calendar.getForexTradingDayStatus(at(iso), "Asia/Kolkata")).toEqual({ open, reason });
      expect(calendar.isForexTradingDay(at(iso), "Asia/Kolkata")).toBe(open);
    });

    it("evaluates the weekend in the given timezone, not UTC", () => {
      // Saturday 00:30 IST is still Friday 19:00 UTC.
      const fridayNightUtc = at("2026-09-18T19:00:00.000Z");
      expect(calendar.isForexTradingDay(fridayNightUtc, "UTC")).toBe(true);
      expect(calendar.isForexTradingDay(fridayNightUtc, "Asia/Kolkata")).toBe(false);
    });

    it("Indian exchange holidays do NOT close Forex", () => {
      expect(calendar.isForexTradingDay(at("2026-10-02T07:15:00.000Z"), "Asia/Kolkata")).toBe(true);
    });
  });

  describe("Indian Market", () => {
    it.each([
      ["Monday 09:00 IST", "2026-09-21T03:30:00.000Z", true, null],
      ["Saturday 09:00 IST", "2026-09-19T03:30:00.000Z", false, "WEEKEND"],
      ["Sunday 09:00 IST", "2026-09-20T03:30:00.000Z", false, "WEEKEND"],
      ["Gandhi Jayanti 09:00 IST", "2026-10-02T03:30:00.000Z", false, "HOLIDAY"],
      ["Republic Day 09:00 IST", "2026-01-26T03:30:00.000Z", false, "HOLIDAY"],
    ])("%s → open=%s", (_label, iso, open, reason) => {
      expect(calendar.getIndianMarketDayStatus(at(iso))).toEqual({ open, reason });
      expect(calendar.isIndianMarketOpenDay(at(iso))).toBe(open);
    });

    it("always evaluates in IST regardless of caller timezone", () => {
      // Sunday 23:30 IST == Sunday 18:00 UTC; Monday in Tokyo already.
      const sundayNightIst = at("2026-09-20T18:00:00.000Z");
      expect(calendar.isIndianMarketOpenDay(sundayNightIst)).toBe(false);
    });

    it("INDIAN_MARKET_HOLIDAYS env replaces the built-in list", () => {
      process.env.INDIAN_MARKET_HOLIDAYS = "2026-09-21";
      expect(calendar.isIndianMarketOpenDay(at("2026-09-21T03:30:00.000Z"))).toBe(false);
      // Built-in Gandhi Jayanti no longer listed once the env override is set.
      expect(calendar.isIndianMarketOpenDay(at("2026-10-02T03:30:00.000Z"))).toBe(true);
    });

    it("ignores malformed env entries", () => {
      process.env.INDIAN_MARKET_HOLIDAYS = "garbage, 2026/09/21";
      // Falls back to the built-in list because nothing valid was supplied.
      expect(calendar.isIndianMarketOpenDay(at("2026-10-02T03:30:00.000Z"))).toBe(false);
    });
  });

  it("getMarketDayStatus treats an unknown market as closed", () => {
    expect(calendar.getMarketDayStatus("Crypto", at("2026-09-21T03:30:00.000Z"))).toEqual({
      open: false,
      reason: "UNKNOWN_MARKET",
    });
  });
});
