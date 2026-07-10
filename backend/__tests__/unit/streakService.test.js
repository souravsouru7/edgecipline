jest.mock("../../models/DailyDisciplineEntry", () => ({
  findOneAndUpdate: jest.fn(),
  find:             jest.fn(),
  findOne:          jest.fn(),
}));

jest.mock("../../models/Users", () => ({
  findById:  jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock("../../models/NotificationPreference", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const DailyDisciplineEntry = require("../../models/DailyDisciplineEntry");
const User = require("../../models/Users");
const NotificationPreference = require("../../models/NotificationPreference");

const streakService = require("../../services/streak.service");
const {
  dayKeyInTz,
  addDays,
  diffDays,
  computeStreaksFromEntries,
  MILESTONE_DAYS,
  GRACE_MIN_STREAK,
  DEFAULT_RULE_THRESHOLD,
} = streakService;

function mockUser(streaks = {}) {
  // Wire both Users.findById call sites: getUserTimezone (select + lean)
  // and recomputeStreaks (select + lean).
  User.findById.mockReturnValue({
    select: () => ({
      lean: async () => ({ _id: "user-1", streaks }),
    }),
  });
}

function mockPrefs(timezone = "Asia/Kolkata") {
  NotificationPreference.findOne.mockReturnValue({
    select: () => ({
      lean: async () => ({ quietHours: { timezone } }),
    }),
  });
}

function mockEntries(entries) {
  DailyDisciplineEntry.find.mockReturnValue({
    sort: () => ({
      lean: async () => entries,
    }),
  });
}

describe("streak.service — time helpers", () => {
  test("dayKeyInTz returns YYYY-MM-DD in the supplied timezone", () => {
    // 2026-06-28T20:00:00Z is 01:30 next-day IST
    expect(dayKeyInTz(new Date("2026-06-28T20:00:00Z"), "Asia/Kolkata")).toBe("2026-06-29");
    expect(dayKeyInTz(new Date("2026-06-28T20:00:00Z"), "UTC")).toBe("2026-06-28");
  });

  test("addDays handles month and year rollovers", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  test("diffDays is calendar-day difference", () => {
    expect(diffDays("2026-06-29", "2026-06-28")).toBe(1);
    expect(diffDays("2026-06-30", "2026-06-28")).toBe(2);
    expect(diffDays("2026-06-28", "2026-06-28")).toBe(0);
  });

  test("MILESTONE_DAYS and constants are sane", () => {
    expect(MILESTONE_DAYS[0]).toBe(3);
    expect(MILESTONE_DAYS).toContain(7);
    expect(MILESTONE_DAYS).toContain(30);
    expect(GRACE_MIN_STREAK).toBe(7);
    expect(DEFAULT_RULE_THRESHOLD).toBe(70);
  });
});

describe("streak.service — computeStreaksFromEntries (pure)", () => {
  const TODAY = "2026-06-28";

  test("journal streak grows over contiguous trading days", () => {
    const entries = [
      { day: "2026-06-26", tradeCount: 1, noTradeToday: false, checklistUsed: false, ruleHit: false, meta: {} },
      { day: "2026-06-27", tradeCount: 2, noTradeToday: false, checklistUsed: false, ruleHit: false, meta: {} },
      { day: "2026-06-28", tradeCount: 1, noTradeToday: false, checklistUsed: false, ruleHit: false, meta: {} },
    ];
    const out = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    expect(out.journal.current).toBe(3);
    expect(out.journal.longest).toBe(3);
    expect(out.journal.lastQualifyingDate).toBe(TODAY);
  });

  test("journal streak treats 'No Trade Today' as a qualifying day", () => {
    const entries = [
      { day: "2026-06-26", tradeCount: 1, noTradeToday: false, meta: {} },
      { day: "2026-06-27", tradeCount: 0, noTradeToday: true,  meta: {} },
      { day: "2026-06-28", tradeCount: 1, noTradeToday: false, meta: {} },
    ];
    const out = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    expect(out.journal.current).toBe(3);
  });

  test("journal current is 0 when last qualifying day is older than yesterday", () => {
    const entries = [
      { day: "2026-06-20", tradeCount: 1, meta: {} },
      { day: "2026-06-21", tradeCount: 1, meta: {} },
      // gap from 2026-06-22 through TODAY
    ];
    const out = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    expect(out.journal.current).toBe(0);
    expect(out.journal.longest).toBe(2);
  });

  test("journal current survives a one-day gap when streak ends on yesterday", () => {
    const entries = [
      { day: "2026-06-26", tradeCount: 1, meta: {} },
      { day: "2026-06-27", tradeCount: 1, meta: {} },
    ];
    const out = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    expect(out.journal.current).toBe(2);
  });

  test("rule streak counts trailing trades with setupScore >= threshold", () => {
    const entries = [
      { day: "2026-06-26", tradeCount: 2, meta: { setupScores: [80, 60], firstTradeAt: new Date("2026-06-26T10:00Z") } },
      { day: "2026-06-27", tradeCount: 2, meta: { setupScores: [90, 75], firstTradeAt: new Date("2026-06-27T10:00Z") } },
      { day: "2026-06-28", tradeCount: 1, meta: { setupScores: [82],     firstTradeAt: new Date("2026-06-28T10:00Z") } },
    ];
    const out = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    // 80, 60 (reset), 90, 75, 82 → trailing run = 3
    expect(out.rule.current).toBe(3);
    expect(out.rule.longest).toBe(3);
  });

  test("rule streak respects custom threshold", () => {
    const entries = [
      { day: "2026-06-28", tradeCount: 2, meta: { setupScores: [85, 78], firstTradeAt: new Date("2026-06-28T10:00Z") } },
    ];
    const high = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 80 });
    expect(high.rule.current).toBe(0); // 78 < 80 breaks
    const mid = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    expect(mid.rule.current).toBe(2);
  });

  test("checklist streak counts only trading days where checklist was used", () => {
    const entries = [
      { day: "2026-06-26", tradeCount: 1, checklistUsed: true,  meta: {} },
      { day: "2026-06-27", tradeCount: 0, noTradeToday: true,   meta: {} }, // skip
      { day: "2026-06-28", tradeCount: 1, checklistUsed: true,  meta: {} },
    ];
    const out = computeStreaksFromEntries(entries, { todayKey: TODAY, ruleThreshold: 70 });
    expect(out.checklist.current).toBe(2);
  });

  test("empty entries return zero streaks", () => {
    const out = computeStreaksFromEntries([], { todayKey: TODAY, ruleThreshold: 70 });
    expect(out.journal.current).toBe(0);
    expect(out.checklist.current).toBe(0);
    expect(out.rule.current).toBe(0);
  });
});

describe("streak.service — recomputeStreaks integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-06-28T08:00:00.000Z"));
    mockPrefs("Asia/Kolkata");
    User.updateOne.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("persists denormalized counters and detects milestone", async () => {
    mockUser({
      journal: { current: 6, longest: 6 },
      lastMilestoneNotified: 3,
    });
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays("2026-06-28", -i);
      days.push({ day, tradeCount: 1, noTradeToday: false, checklistUsed: false, ruleHit: false, meta: {} });
    }
    mockEntries(days);

    const result = await streakService.recomputeStreaks("user-1");
    expect(result.streaks.journal.current).toBe(7);
    expect(result.events.newMilestone).toBe(7);
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "streaks.journal.current": 7,
          "streaks.lastMilestoneNotified": 7,
        }),
      })
    );
  });

  test("does not re-fire a milestone already notified", async () => {
    mockUser({
      journal: { current: 7, longest: 7 },
      lastMilestoneNotified: 7,
    });
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays("2026-06-28", -i);
      days.push({ day, tradeCount: 1, meta: {} });
    }
    mockEntries(days);

    const result = await streakService.recomputeStreaks("user-1");
    expect(result.events.newMilestone).toBeNull();
  });

  test("grace recovery extends a broken ≥7 streak when user logs the next day", async () => {
    // Yesterday was missed. Today (2026-06-28) the user logged. Previous
    // streak was 8 days, no recovery in the last 30 days — should restore.
    mockUser({
      journal: {
        current: 8,
        longest: 8,
        lastQualifyingDate: "2026-06-26",
        lastRecoveryAt: null,
        lastBrokenAt: null,
      },
      lastMilestoneNotified: 7,
    });
    mockEntries([
      // Days 06-19 to 06-26 (8 days)
      ...Array.from({ length: 8 }, (_, i) => ({
        day: addDays("2026-06-26", -i),
        tradeCount: 1,
        meta: {},
      })).reverse(),
      // 06-27 missed entirely
      { day: "2026-06-28", tradeCount: 1, meta: {} }, // today
    ]);

    const result = await streakService.recomputeStreaks("user-1");
    expect(result.events.recovered).toBe(true);
    expect(result.streaks.journal.current).toBe(9);
  });

  test("grace recovery is suppressed if already used in last 30 days", async () => {
    mockUser({
      journal: {
        current: 8,
        longest: 8,
        lastRecoveryAt: new Date("2026-06-20T10:00:00.000Z"), // 8 days ago
      },
      lastMilestoneNotified: 7,
    });
    mockEntries([
      ...Array.from({ length: 8 }, (_, i) => ({
        day: addDays("2026-06-26", -i),
        tradeCount: 1,
        meta: {},
      })).reverse(),
      { day: "2026-06-28", tradeCount: 1, meta: {} },
    ]);

    const result = await streakService.recomputeStreaks("user-1");
    expect(result.events.recovered).toBe(false);
    expect(result.events.broken).toBe(true);
    expect(result.streaks.journal.current).toBe(1);
  });
});

describe("streak.service — markNoTradeToday", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-06-28T08:00:00.000Z"));
    mockPrefs("Asia/Kolkata");
    DailyDisciplineEntry.findOneAndUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("refuses to mark sat-out when the day already has real trades", async () => {
    DailyDisciplineEntry.findOne.mockReturnValue({
      lean: async () => ({ tradeCount: 2 }),
    });
    const out = await streakService.markNoTradeToday("user-1");
    expect(out.alreadyTraded).toBe(true);
    expect(DailyDisciplineEntry.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("upserts a sat-out entry when no trades exist", async () => {
    DailyDisciplineEntry.findOne.mockReturnValue({ lean: async () => null });
    const out = await streakService.markNoTradeToday("user-1", { note: "high impact news" });
    expect(out.alreadyTraded).toBe(false);
    expect(DailyDisciplineEntry.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ user: "user-1" }),
      expect.objectContaining({
        $set: expect.objectContaining({ noTradeToday: true, "meta.note": "high impact news" }),
      }),
      expect.any(Object)
    );
  });
});
