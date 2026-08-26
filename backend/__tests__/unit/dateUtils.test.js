"use strict";

const { normalizeTradeDate } = require("../../utils/dateUtils");

describe("normalizeTradeDate", () => {
  test("accepts a real leap-day date and rejects invalid calendar dates", () => {
    expect(normalizeTradeDate("2024-02-29")).toBeInstanceOf(Date);

    expect(() => normalizeTradeDate("2025-02-29"))
      .toThrow("Trade date is invalid");
    expect(() => normalizeTradeDate("2026-04-31"))
      .toThrow("Trade date is invalid");
  });

  test("rejects future calendar dates", () => {
    expect(() => normalizeTradeDate("2099-01-01"))
      .toThrow("Trade date cannot be in the future");
  });

  test("preserves the submitted calendar day for ISO strings with offsets", () => {
    const normalized = normalizeTradeDate("2026-08-16T23:30:00-05:00");

    expect(normalized.getFullYear()).toBe(2026);
    expect(normalized.getMonth()).toBe(7);
    expect(normalized.getDate()).toBe(16);
  });
});
