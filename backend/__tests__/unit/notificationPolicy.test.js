const {
  DAILY_PUSH_CAP,
  getCollapseKey,
  getTtlMs,
  isCappedType,
  isPromotionalType,
  isQueueJobStale,
  isWithinPromoWindow,
} = require("../../utils/notificationPolicy");

describe("notificationPolicy", () => {
  describe("expiry", () => {
    it("session reminders expire in 30 minutes (Friday's NY reminder must not land on Saturday)", () => {
      expect(getTtlMs("session_reminder")).toBe(30 * 60 * 1000);
    });
    it("risk alerts expire in an hour, unknown types in 24h", () => {
      expect(getTtlMs("revenge_trading")).toBe(60 * 60 * 1000);
      expect(getTtlMs("payment")).toBe(24 * 60 * 60 * 1000);
    });
    it("only recurring reminders collapse in the tray", () => {
      expect(getCollapseKey("session_reminder")).toBe("edgecipline_session_reminder");
      expect(getCollapseKey("revenge_trading")).toBeNull();
    });
  });

  describe("queue staleness", () => {
    const now = Date.UTC(2026, 10, 8, 12);
    it("drops delivery jobs older than 6h and smart checks older than 3h", () => {
      expect(isQueueJobStale("delivery", now - 7 * 3600e3, now)).toBe(true);
      expect(isQueueJobStale("delivery", now - 5 * 3600e3, now)).toBe(false);
      expect(isQueueJobStale("smartChecks", now - 4 * 3600e3, now)).toBe(true);
    });
    it("never drops when the enqueue time is unknown", () => {
      expect(isQueueJobStale("delivery", undefined, now)).toBe(false);
      expect(isQueueJobStale("unknown-kind", 0, now)).toBe(false);
    });
  });

  describe("promotional window (09:00–21:00 user local)", () => {
    it("recognises renewal / win-back / free-tier types only", () => {
      expect(isPromotionalType("renewal_d_minus_1")).toBe(true);
      expect(isPromotionalType("winback_d_plus_7")).toBe(true);
      expect(isPromotionalType("free_tier_d_plus_3")).toBe(true);
      expect(isPromotionalType("session_reminder")).toBe(false);
      expect(isPromotionalType(undefined)).toBe(false);
    });
    it("uses the user's timezone, not the server's", () => {
      const t = new Date(Date.UTC(2026, 10, 8, 3, 30)); // 09:00 IST, 03:30 London
      expect(isWithinPromoWindow(t, "Asia/Kolkata")).toBe(true);
      expect(isWithinPromoWindow(t, "Europe/London")).toBe(false);
    });
    it("is half-open: 21:00 is outside", () => {
      const nine = new Date(Date.UTC(2026, 10, 8, 15, 30)); // 21:00 IST
      expect(isWithinPromoWindow(nine, "Asia/Kolkata")).toBe(false);
    });
    it("falls back to IST for a bad timezone instead of throwing", () => {
      const t = new Date(Date.UTC(2026, 10, 8, 6));
      expect(() => isWithinPromoWindow(t, "Not/AZone")).not.toThrow();
    });
  });

  describe("daily cap", () => {
    it("never caps risk alerts, support replies, OCR, payment or system", () => {
      for (const type of ["revenge_trading", "daily_loss_warning", "support_agent_reply", "ocr_completed", "payment", "system"]) {
        expect(isCappedType(type)).toBe(false);
      }
    });
    it("caps reminders and promotions", () => {
      for (const type of ["session_reminder", "morning_mentor", "evening_reflection", "free_tier_d_plus_1", "mission_update"]) {
        expect(isCappedType(type)).toBe(true);
      }
      expect(DAILY_PUSH_CAP).toBeGreaterThanOrEqual(6);
    });
  });
});
