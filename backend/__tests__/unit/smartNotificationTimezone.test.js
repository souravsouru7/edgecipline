const {
  formatLocalTime,
  getDayRange,
  getLocalDateKey,
  getWeekKey,
  getWindowKey,
  resolveTimeZone,
} = require("../../utils/timezone");

describe("smart notification timezone helpers", () => {
  const timezone = "Asia/Kolkata";

  it("keeps 23:45 IST on the same local date", () => {
    const tradeTime = new Date("2026-06-13T18:15:00.000Z");

    expect(getLocalDateKey(tradeTime, timezone)).toBe("2026-06-13");
    expect(formatLocalTime(tradeTime, timezone)).toBe("2026-06-13 23:45:00");
  });

  it("moves 00:15 IST to the next local date", () => {
    const tradeTime = new Date("2026-06-13T18:45:00.000Z");

    expect(getLocalDateKey(tradeTime, timezone)).toBe("2026-06-14");
    expect(formatLocalTime(tradeTime, timezone)).toBe("2026-06-14 00:15:00");
  });

  it("builds IST day ranges from local midnight to local midnight", () => {
    const tradeTime = new Date("2026-06-14T03:45:00.000Z");
    const { start, end } = getDayRange(tradeTime, timezone);

    expect(start.toISOString()).toBe("2026-06-13T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-06-14T18:30:00.000Z");
  });

  it("uses trade timestamp, not current server time, for six-hour windows", () => {
    const backdatedTradeTime = new Date("2026-06-13T18:45:00.000Z");

    expect(getLocalDateKey(backdatedTradeTime, timezone)).toBe("2026-06-14");
    expect(getWindowKey(backdatedTradeTime, timezone)).toBe(0);
  });

  it("calculates local week keys from the configured timezone", () => {
    const sundayNightUtcMondayIst = new Date("2026-06-14T19:00:00.000Z");

    expect(getLocalDateKey(sundayNightUtcMondayIst, timezone)).toBe("2026-06-15");
    expect(getWeekKey(sundayNightUtcMondayIst, timezone)).toBe("2026-06-15");
  });

  it("falls back to Asia/Kolkata for invalid timezone names", () => {
    expect(resolveTimeZone("Not/AZone")).toBe("Asia/Kolkata");
  });
});
