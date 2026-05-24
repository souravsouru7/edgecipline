/**
 * Tests for the Morning Trading Mentor Notification System.
 *
 * Groups:
 *  1. Trade analysis logic — thresholds for each signal
 *  2. Message generation — correct scenario routing by priority
 *  3. sendMorningMentor — integration via mocked DB + notifyUser
 *  4. morningMentorCron — execution guard, error isolation, empty list
 */

// ── Top-level mocks (hoisted before all requires) ─────────────────────────────

jest.mock("../config", () => ({
  appConfig: {
    timezoneOffsetHours: 0,
    morningMentor: { enabled: true, schedule: "0 7 * * *" },
  },
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "notif-1", status: "sent" }),
}));

jest.mock("../models/Trade", () => ({ find: jest.fn() }));
jest.mock("../models/IndianTrade", () => ({ find: jest.fn() }));

// ── Shared helpers ────────────────────────────────────────────────────────────

const Trade            = require("../models/Trade");
const IndianTrade      = require("../models/IndianTrade");
const notifService     = require("../services/notificationService");

// Make Trade/IndianTrade.find().lean() return the given arrays
function mockTrades(forex = [], indian = []) {
  Trade.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(forex) });
  IndianTrade.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(indian) });
}

// Known UTC timestamps for deterministic day-of-week
const MONDAY_TS   = new Date("2026-05-04T07:00:00Z").getTime(); // UTCDay = 1
const SATURDAY_TS = new Date("2026-05-02T07:00:00Z").getTime(); // UTCDay = 6
const SUNDAY_TS   = new Date("2026-05-03T07:00:00Z").getTime(); // UTCDay = 0

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Trade analysis logic
// Replicated exactly from morningMentorService.js so thresholds are exercised
// without needing DB access.
// ═══════════════════════════════════════════════════════════════════════════════

const EMOTION_TAGS_SET = new Set([
  "fomo","revenge","fear","frustrated","stressed",
  "greedy","impatient","hesitant","overconfident","anxiety",
]);

function analyzeTrades(trades) {
  const total  = trades.length;
  const wins   = trades.filter(t => (t.profit || 0) > 0).length;
  const losses = trades.filter(t => (t.profit || 0) < 0).length;
  const totalPnl = Math.round(trades.reduce((s, t) => s + (t.profit || 0), 0) * 100) / 100;

  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate || a.createdAt) - new Date(b.tradeDate || b.createdAt)
  );
  let streak = 0, maxStreak = 0;
  for (const t of sorted) {
    if ((t.profit || 0) < 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }

  const noStopLossCount = trades.filter(t => !t.stopLoss || t.stopLoss <= 0).length;
  const avgSetupScore = total > 0
    ? Math.round(trades.reduce((s, t) => s + (t.setupScore || 0), 0) / total)
    : 0;

  let emotionCount = 0;
  for (const t of trades) {
    const tags = Array.isArray(t.emotionalTags) ? t.emotionalTags : [];
    if (tags.some(tag => EMOTION_TAGS_SET.has(String(tag).toLowerCase()))) emotionCount++;
    if ((t.mood || 3) <= 2) emotionCount++;
  }

  const impulsiveEntries = trades.filter(
    t => t.entryBasis === "Emotion" || t.entryBasis === "Impulsive"
  ).length;

  return {
    total, wins, losses, totalPnl,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    isRevengeTrading: maxStreak >= 3,
    noStopLossCount,
    noStopLossRate: total > 0 ? noStopLossCount / total : 0,
    avgSetupScore,
    emotionCount, impulsiveEntries,
    isOvertrading: total > 5,
    isProfitable: totalPnl > 0,
  };
}

describe("analyzeTrades — scoring thresholds", () => {
  it("detects revenge trading: 3 consecutive losses → isRevengeTrading=true", () => {
    const trades = [
      { profit: -10, tradeDate: "2026-05-03T09:00Z" },
      { profit: -20, tradeDate: "2026-05-03T10:00Z" },
      { profit: -15, tradeDate: "2026-05-03T11:00Z" },
    ];
    const r = analyzeTrades(trades);
    expect(r.isRevengeTrading).toBe(true);
    expect(r.losses).toBe(3);
  });

  it("no revenge trading: exactly 2 consecutive losses", () => {
    const trades = [
      { profit: -10, tradeDate: "2026-05-03T09:00Z" },
      { profit: -20, tradeDate: "2026-05-03T10:00Z" },
      { profit: 50,  tradeDate: "2026-05-03T11:00Z" },
    ];
    expect(analyzeTrades(trades).isRevengeTrading).toBe(false);
  });

  it("no revenge trading: losses interrupted by a win", () => {
    const trades = [
      { profit: -10, tradeDate: "2026-05-03T09:00Z" },
      { profit:  20, tradeDate: "2026-05-03T10:00Z" },
      { profit: -15, tradeDate: "2026-05-03T11:00Z" },
      { profit:  -5, tradeDate: "2026-05-03T12:00Z" },
    ];
    expect(analyzeTrades(trades).isRevengeTrading).toBe(false);
  });

  it("overtrading: 6 trades → isOvertrading=true", () => {
    const trades = Array.from({ length: 6 }, (_, i) => ({ profit: i % 2 === 0 ? 10 : -5 }));
    expect(analyzeTrades(trades).isOvertrading).toBe(true);
  });

  it("no overtrading: exactly 5 trades", () => {
    const trades = Array.from({ length: 5 }, () => ({ profit: 10 }));
    expect(analyzeTrades(trades).isOvertrading).toBe(false);
  });

  it("noStopLossRate: 2 of 3 trades missing SL → rate ≈ 0.667", () => {
    const trades = [
      { profit: 10, stopLoss: 0 },
      { profit: -5, stopLoss: null },
      { profit: 20, stopLoss: 1.35 },
    ];
    const r = analyzeTrades(trades);
    expect(r.noStopLossCount).toBe(2);
    expect(r.noStopLossRate).toBeCloseTo(2 / 3);
  });

  it("emotionCount: counts trades with recognised emotional tags", () => {
    const trades = [
      { profit: -10, emotionalTags: ["fomo", "stressed"] }, // counted
      { profit:  20, emotionalTags: ["calm"] },              // not counted
      { profit:  -5, emotionalTags: ["revenge"] },           // counted
    ];
    expect(analyzeTrades(trades).emotionCount).toBe(2);
  });

  it("emotionCount: low mood (≤2) increments count independently of tags", () => {
    const trades = [
      { profit: 10, mood: 1 }, // counted via mood
      { profit: -5, mood: 4 }, // not counted
    ];
    expect(analyzeTrades(trades).emotionCount).toBe(1);
  });

  it("impulsiveEntries counts Emotion and Impulsive entryBasis", () => {
    const trades = [
      { profit: 10, entryBasis: "Impulsive" },
      { profit: -5, entryBasis: "Plan" },
      { profit: 15, entryBasis: "Emotion" },
    ];
    expect(analyzeTrades(trades).impulsiveEntries).toBe(2);
  });

  it("winRate: 2 wins 2 losses → 50%", () => {
    const trades = [
      { profit: 10 }, { profit: 20 },
      { profit: -5 }, { profit: -10 },
    ];
    expect(analyzeTrades(trades).winRate).toBe(50);
  });

  it("avgSetupScore: averages and rounds correctly", () => {
    const trades = [
      { profit: 10, setupScore: 80 },
      { profit: -5, setupScore: 60 },
      { profit: 15, setupScore: 70 },
    ];
    expect(analyzeTrades(trades).avgSetupScore).toBe(70);
  });

  it("isProfitable: true when totalPnl > 0", () => {
    const trades = [{ profit: 100 }, { profit: -30 }];
    expect(analyzeTrades(trades).isProfitable).toBe(true);
  });

  it("isProfitable: false when totalPnl ≤ 0", () => {
    const trades = [{ profit: 10 }, { profit: -50 }];
    expect(analyzeTrades(trades).isProfitable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Message generation (priority routing)
// Replicated from morningMentorService.js to test decision logic in isolation.
// ═══════════════════════════════════════════════════════════════════════════════

function generateTradedMessage(a) {
  if (a.isRevengeTrading)
    return { title: "🛑 Stop. Breathe. Think.", scenario: "revenge" };
  if (a.noStopLossRate >= 0.5)
    return { title: "🛡️ Protect Your Capital First.", scenario: "no_stop_loss" };
  if (a.isOvertrading)
    return { title: "🎯 Quality Over Quantity.", scenario: "overtrading" };
  if (a.emotionCount >= 2 || a.impulsiveEntries >= 2)
    return { title: "🧘 Rules, Not Emotions.", scenario: "emotional" };
  if (a.avgSetupScore < 60 && a.total > 0)
    return { title: "📉 Your Edge Is Slipping.", scenario: "low_setup" };
  if (!a.isProfitable && a.total > 0)
    return { title: "🔄 Losses Are Part of the Process.", scenario: "loss_day" };
  if (a.isProfitable && a.avgSetupScore >= 70)
    return { title: "🔥 Discipline Is Delivering.", scenario: "disciplined_win" };
  if (a.isProfitable)
    return { title: "✅ Stay Consistent.", scenario: "profitable" };
  return { title: "🌅 Reset. Refocus. Execute.", scenario: "reset" };
}

const base = (overrides) => ({
  total: 3, wins: 1, losses: 2, winRate: 33,
  isRevengeTrading: false, noStopLossCount: 0, noStopLossRate: 0,
  avgSetupScore: 72, emotionCount: 0, impulsiveEntries: 0,
  isOvertrading: false, isProfitable: false,
  ...overrides,
});

describe("generateTradedMessage — scenario priority routing", () => {
  it("revenge trading → title '🛑 Stop. Breathe. Think.'", () => {
    const msg = generateTradedMessage(base({ isRevengeTrading: true }));
    expect(msg.title).toBe("🛑 Stop. Breathe. Think.");
    expect(msg.scenario).toBe("revenge");
  });

  it("no stop loss (rate 1.0) → '🛡️ Protect Your Capital First.'", () => {
    const msg = generateTradedMessage(base({ noStopLossCount: 3, noStopLossRate: 1 }));
    expect(msg.title).toBe("🛡️ Protect Your Capital First.");
    expect(msg.scenario).toBe("no_stop_loss");
  });

  it("no stop loss threshold: rate=0.5 triggers, rate=0.49 does not", () => {
    expect(generateTradedMessage(base({ noStopLossRate: 0.5 })).scenario).toBe("no_stop_loss");
    expect(generateTradedMessage(base({ noStopLossRate: 0.49 })).scenario).not.toBe("no_stop_loss");
  });

  it("overtrading (6 trades) → '🎯 Quality Over Quantity.'", () => {
    const msg = generateTradedMessage(base({ total: 6, isOvertrading: true }));
    expect(msg.title).toBe("🎯 Quality Over Quantity.");
    expect(msg.scenario).toBe("overtrading");
  });

  it("emotionCount ≥ 2 → '🧘 Rules, Not Emotions.'", () => {
    const msg = generateTradedMessage(base({ emotionCount: 2 }));
    expect(msg.title).toBe("🧘 Rules, Not Emotions.");
  });

  it("impulsiveEntries ≥ 2 also triggers 'Rules, Not Emotions.'", () => {
    const msg = generateTradedMessage(base({ impulsiveEntries: 2 }));
    expect(msg.scenario).toBe("emotional");
  });

  it("low setup score (<60) → '📉 Your Edge Is Slipping.'", () => {
    const msg = generateTradedMessage(base({ avgSetupScore: 45 }));
    expect(msg.title).toBe("📉 Your Edge Is Slipping.");
    expect(msg.scenario).toBe("low_setup");
  });

  it("setup score boundary: 59 triggers, 60 does not", () => {
    expect(generateTradedMessage(base({ avgSetupScore: 59 })).scenario).toBe("low_setup");
    expect(generateTradedMessage(base({ avgSetupScore: 60 })).scenario).not.toBe("low_setup");
  });

  it("losing day with good discipline → '🔄 Losses Are Part of the Process.'", () => {
    const msg = generateTradedMessage(base({ avgSetupScore: 72, isProfitable: false }));
    expect(msg.title).toBe("🔄 Losses Are Part of the Process.");
  });

  it("profitable + setupScore ≥ 70 → '🔥 Discipline Is Delivering.'", () => {
    const msg = generateTradedMessage(base({ isProfitable: true, avgSetupScore: 80 }));
    expect(msg.title).toBe("🔥 Discipline Is Delivering.");
    expect(msg.scenario).toBe("disciplined_win");
  });

  it("profitable + setupScore < 70 → '✅ Stay Consistent.'", () => {
    const msg = generateTradedMessage(base({ isProfitable: true, avgSetupScore: 65 }));
    expect(msg.title).toBe("✅ Stay Consistent.");
    expect(msg.scenario).toBe("profitable");
  });

  it("revenge takes priority over overtrading + stop-loss + emotional", () => {
    const allBad = base({
      isRevengeTrading: true, noStopLossRate: 1,
      isOvertrading: true, emotionCount: 5,
    });
    expect(generateTradedMessage(allBad).scenario).toBe("revenge");
  });

  it("stop-loss takes priority over overtrading + emotional", () => {
    const msg = generateTradedMessage(base({
      noStopLossRate: 0.6, isOvertrading: true, emotionCount: 3,
    }));
    expect(msg.scenario).toBe("no_stop_loss");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — sendMorningMentor integration (mocked DB + notifyUser)
// ═══════════════════════════════════════════════════════════════════════════════

describe("sendMorningMentor — scenario routing via mocked dependencies", () => {
  const { sendMorningMentor } = require("../services/morningMentorService");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Weekend ────────────────────────────────────────────────────────────────

  it("Saturday: sends weekend scenario, does NOT query DB, deepLink=/notifications", async () => {
    jest.spyOn(Date, "now").mockReturnValue(SATURDAY_TS);

    await sendMorningMentor("user-sat");

    expect(Trade.find).not.toHaveBeenCalled();
    expect(IndianTrade.find).not.toHaveBeenCalled();
    const payload = notifService.notifyUser.mock.calls[0][1];
    expect(payload.type).toBe("morning_mentor");
    expect(payload.data.scenario).toBe("weekend");
    expect(payload.deepLink).toBe("/notifications");

    Date.now.mockRestore();
  });

  it("Sunday: also sends weekend scenario", async () => {
    jest.spyOn(Date, "now").mockReturnValue(SUNDAY_TS);

    await sendMorningMentor("user-sun");

    expect(notifService.notifyUser.mock.calls[0][1].data.scenario).toBe("weekend");

    Date.now.mockRestore();
  });

  // ── No trade ──────────────────────────────────────────────────────────────

  it("no trades yesterday: sends no_trade scenario, deepLink=/trades", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([], []);

    await sendMorningMentor("user-idle");

    const payload = notifService.notifyUser.mock.calls[0][1];
    expect(payload.type).toBe("morning_mentor");
    expect(payload.data.scenario).toBe("no_trade");
    expect(payload.deepLink).toBe("/trades");

    Date.now.mockRestore();
  });

  it("no_trade: title is one of the 5 rotation messages", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([], []);

    await sendMorningMentor("user-idle2");

    const { title } = notifService.notifyUser.mock.calls[0][1];
    const validTitles = [
      "🧘 No Trade Is a Trade.",
      "✅ Discipline Is Choosing Not to Trade.",
      "🎯 Quality Over Activity.",
      "🛡️ Patience Protects Capital.",
      "⏳ Waiting Is a Skill.",
    ];
    expect(validTitles).toContain(title);

    Date.now.mockRestore();
  });

  // ── Traded ────────────────────────────────────────────────────────────────

  it("3 consecutive losses → revenge scenario '🛑 Stop. Breathe. Think.'", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([
      { profit: -10, tradeDate: "2026-05-03T09:00Z", createdAt: "2026-05-03T09:00Z" },
      { profit: -20, tradeDate: "2026-05-03T10:00Z", createdAt: "2026-05-03T10:00Z" },
      { profit: -15, tradeDate: "2026-05-03T11:00Z", createdAt: "2026-05-03T11:00Z" },
    ], []);

    await sendMorningMentor("user-revenge");

    const payload = notifService.notifyUser.mock.calls[0][1];
    expect(payload.title).toBe("🛑 Stop. Breathe. Think.");
    expect(payload.data.scenario).toBe("revenge");

    Date.now.mockRestore();
  });

  it("profitable + high setup score → disciplined_win scenario", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([
      { profit: 80,  setupScore: 85, stopLoss: 1.33, tradeDate: "2026-05-03T09:00Z", createdAt: "2026-05-03T09:00Z" },
      { profit: 40,  setupScore: 90, stopLoss: 1.34, tradeDate: "2026-05-03T11:00Z", createdAt: "2026-05-03T11:00Z" },
      { profit: -10, setupScore: 75, stopLoss: 1.35, tradeDate: "2026-05-03T13:00Z", createdAt: "2026-05-03T13:00Z" },
    ], []);

    await sendMorningMentor("user-win");

    const payload = notifService.notifyUser.mock.calls[0][1];
    expect(payload.title).toBe("🔥 Discipline Is Delivering.");
    expect(payload.data.scenario).toBe("disciplined_win");

    Date.now.mockRestore();
  });

  it("combines Forex + Indian trades for analysis — cross-market revenge", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    // 2 Forex + 1 Indian = 3 consecutive losses → revenge
    mockTrades(
      [
        { profit: -10, tradeDate: "2026-05-03T09:00Z", createdAt: "2026-05-03T09:00Z" },
        { profit: -20, tradeDate: "2026-05-03T10:00Z", createdAt: "2026-05-03T10:00Z" },
      ],
      [
        { profit: -15, tradeDate: "2026-05-03T11:00Z", createdAt: "2026-05-03T11:00Z" },
      ]
    );

    await sendMorningMentor("user-mixed");

    const payload = notifService.notifyUser.mock.calls[0][1];
    expect(payload.title).toBe("🛑 Stop. Breathe. Think.");
    expect(payload.data.totalTrades).toBe(3);

    Date.now.mockRestore();
  });

  // ── Payload shape ─────────────────────────────────────────────────────────

  it("dedupeKey format: morning-mentor:{userId}:YYYY-MM-DD", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([], []);

    await sendMorningMentor("user-dedupe");

    const { dedupeKey } = notifService.notifyUser.mock.calls[0][1];
    expect(dedupeKey).toMatch(/^morning-mentor:user-dedupe:\d{4}-\d{2}-\d{2}$/);

    Date.now.mockRestore();
  });

  it("always uses type: 'morning_mentor'", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([], []);

    await sendMorningMentor("user-type");

    expect(notifService.notifyUser.mock.calls[0][1].type).toBe("morning_mentor");

    Date.now.mockRestore();
  });

  it("passes the correct userId to notifyUser as first argument", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([], []);

    await sendMorningMentor("specific-user-id");

    expect(notifService.notifyUser.mock.calls[0][0]).toBe("specific-user-id");

    Date.now.mockRestore();
  });

  it("Forex Trade.find includes ghost-trade filter", async () => {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_TS);
    mockTrades([], []);

    await sendMorningMentor("user-ghost");

    const [query] = Trade.find.mock.calls[0];
    expect(query).toMatchObject({ "parsedData.multiTradeGhost": { $ne: true } });

    Date.now.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — morningMentorCron: execution guard + error isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe("morningMentorCron — runMorningMentorJob", () => {
  let runMorningMentorJob;

  beforeEach(() => {
    jest.resetModules();

    jest.mock("../config", () => ({
      appConfig: {
        timezoneOffsetHours: 0,
        morningMentor: { enabled: true, schedule: "0 7 * * *" },
      },
    }));
    jest.mock("../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.mock("../services/morningMentorService", () => ({
      sendMorningMentor: jest.fn().mockResolvedValue({}),
    }));
    jest.mock("../repositories/user.repository", () => ({
      findUsersForWeeklyReports: jest.fn(),
    }));

    ({ runMorningMentorJob } = require("../jobs/morningMentorCron"));
  });

  it("calls sendMorningMentor once per user returned by the repository", async () => {
    const userRepo       = require("../repositories/user.repository");
    const { sendMorningMentor } = require("../services/morningMentorService");

    userRepo.findUsersForWeeklyReports.mockResolvedValue([
      { _id: "u1" }, { _id: "u2" }, { _id: "u3" },
    ]);

    await runMorningMentorJob();

    expect(sendMorningMentor).toHaveBeenCalledTimes(3);
    expect(sendMorningMentor).toHaveBeenCalledWith("u1");
    expect(sendMorningMentor).toHaveBeenCalledWith("u2");
    expect(sendMorningMentor).toHaveBeenCalledWith("u3");
  });

  it("one user failure does not stop processing the remaining users", async () => {
    const userRepo       = require("../repositories/user.repository");
    const { sendMorningMentor } = require("../services/morningMentorService");

    userRepo.findUsersForWeeklyReports.mockResolvedValue([
      { _id: "u1" }, { _id: "u2" }, { _id: "u3" },
    ]);
    sendMorningMentor
      .mockResolvedValueOnce({})                          // u1 ok
      .mockRejectedValueOnce(new Error("FCM timeout"))    // u2 fails
      .mockResolvedValueOnce({});                         // u3 ok

    await expect(runMorningMentorJob()).resolves.not.toThrow();
    expect(sendMorningMentor).toHaveBeenCalledTimes(3);
  });

  it("does not throw when user list is empty", async () => {
    const userRepo = require("../repositories/user.repository");
    userRepo.findUsersForWeeklyReports.mockResolvedValue([]);

    await expect(runMorningMentorJob()).resolves.not.toThrow();
  });

  it("handles repository failure gracefully — does not throw", async () => {
    const userRepo = require("../repositories/user.repository");
    userRepo.findUsersForWeeklyReports.mockRejectedValue(new Error("DB connection lost"));

    await expect(runMorningMentorJob()).resolves.not.toThrow();
  });

  it("logs an error when repository fetch fails", async () => {
    const userRepo = require("../repositories/user.repository");
    const { logger } = require("../utils/logger");
    userRepo.findUsersForWeeklyReports.mockRejectedValue(new Error("DB timeout"));

    await runMorningMentorJob();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("morningMentorCron"),
      expect.objectContaining({ error: "DB timeout" })
    );
  });

  it("logs completion summary after all users are processed", async () => {
    const userRepo = require("../repositories/user.repository");
    const { logger } = require("../utils/logger");

    userRepo.findUsersForWeeklyReports.mockResolvedValue([{ _id: "u1" }, { _id: "u2" }]);

    await runMorningMentorJob();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("morningMentorCron"),
      expect.objectContaining({ total: 2, success: 2, errors: 0 })
    );
  });
});
