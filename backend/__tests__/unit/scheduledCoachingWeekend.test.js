/**
 * Weekend classification of the scheduled crons.
 *
 *   Market-dependent  → session reminders (covered in sessionReminderCron.test)
 *   Behaviour-dependent → Morning Mentor, Evening Reflection, Streak Protector
 *
 * The behaviour-dependent ones MUST keep running on Saturday/Sunday; they only
 * must not claim a market is opening.
 */
jest.mock("../../config", () => ({
  appConfig: {
    cron: { concurrency: 5 },
    morningMentor: { enabled: true, schedule: "0 7 * * *", timezone: "Asia/Kolkata", timezoneOffsetHours: 5.5 },
    reflectionReminder: { enabled: true, schedule: "30 19 * * *", timezone: "Asia/Kolkata", concurrency: 5 },
    streakProtector: { enabled: true, schedule: "0 21 * * *", timezone: "Asia/Kolkata", minStreak: 3 },
    timezoneOffsetHours: 5.5,
  },
}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../models/Trade", () => ({ find: jest.fn(), countDocuments: jest.fn(), distinct: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ find: jest.fn(), countDocuments: jest.fn(), distinct: jest.fn() }));
jest.mock("../../models/DailyReflection", () => ({ findOne: jest.fn() }));
jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "n", status: "sent" }),
}));
jest.mock("../../services/streakNotification.service", () => ({
  sendAtRisk: jest.fn().mockResolvedValue({ _id: "n", status: "sent" }),
}));
jest.mock("../../services/streak.service", () => ({
  getStreakSnapshot: jest.fn().mockResolvedValue({ todayKey: "2026-09-19" }),
  dayKeyInTz: jest.fn(() => "2026-09-19"),
}));
jest.mock("../../repositories/user.repository", () => ({
  findDistinctReminderTimezones: jest.fn().mockResolvedValue(["Asia/Kolkata", null]),
  findReachableUsersByTimezone: jest.fn().mockResolvedValue([
    { _id: "u1", streaks: { journal: { current: 5, lastQualifyingDate: "2026-09-18" }, timezone: "Asia/Kolkata" } },
  ]),
}));

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const DailyReflection = require("../../models/DailyReflection");
const notificationService = require("../../services/notificationService");
const { sendAtRisk } = require("../../services/streakNotification.service");
const { sendMorningMentor } = require("../../services/morningMentorService");
const { runReflectionReminderJob } = require("../../jobs/reflectionReminderCron");
const { runStreakProtectorJob } = require("../../jobs/streakProtectorCron");

const SATURDAY_0700_IST = new Date("2026-09-19T01:30:00.000Z");
const SATURDAY_2100_IST = new Date("2026-09-19T15:30:00.000Z");
const SUNDAY_1930_IST   = new Date("2026-09-20T14:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: SATURDAY_0700_IST });
  const lean = () => Promise.resolve([]);
  Trade.find.mockReturnValue({ lean });
  IndianTrade.find.mockReturnValue({ lean });
  Trade.countDocuments.mockResolvedValue(0);
  IndianTrade.countDocuments.mockResolvedValue(0);
  // u1 has traded at some point (morning mentor / reflection require it).
  Trade.distinct.mockResolvedValue(["u1"]);
  IndianTrade.distinct.mockResolvedValue([]);
  DailyReflection.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
});
afterEach(() => jest.useRealTimers());

describe("Morning Mentor on the weekend", () => {
  it("still sends, uses the weekend variant, and does not announce a market open", async () => {
    await sendMorningMentor("u1");
    expect(notificationService.notifyUser).toHaveBeenCalledTimes(1);
    const payload = notificationService.notifyUser.mock.calls[0][1];
    expect(payload.type).toBe("morning_mentor");
    expect(payload.data.scenario).toBe("weekend");
    expect(payload.dedupeKey).toBe("morning-mentor:u1:2026-09-19");
    expect(`${payload.title} ${payload.body}`).not.toMatch(/London|New York|NIFTY|opens at|market is open/i);
  });
});

describe("Evening Reflection on the weekend", () => {
  it("still sends when the user has not reflected", async () => {
    jest.setSystemTime(SUNDAY_1930_IST);
    await runReflectionReminderJob(SUNDAY_1930_IST);
    expect(notificationService.notifyUser).toHaveBeenCalledWith("u1", expect.objectContaining({
      type: "evening_reflection",
      deepLink: "/reflection",
    }));
  });

  it("is not sent to a user who has never logged a trade", async () => {
    Trade.distinct.mockResolvedValue([]);
    await runReflectionReminderJob(SUNDAY_1930_IST);
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });

  it("is only due at 19:30 in the user's timezone", async () => {
    await runReflectionReminderJob(SATURDAY_0700_IST);
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });

  it("does not send when a DailyReflection already exists for the day", async () => {
    DailyReflection.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: "r1" }) }) });
    await runReflectionReminderJob(SUNDAY_1930_IST);
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });
});

describe("Streak Protector on the weekend", () => {
  it("still nudges a user whose streak is at risk", async () => {
    await runStreakProtectorJob(SATURDAY_2100_IST);
    expect(sendAtRisk).toHaveBeenCalledWith("u1", { currentStreak: 5, dayKey: "2026-09-19" });
  });

  it("does not tell a lapsed user their (stale) streak is alive", async () => {
    const repo = require("../../repositories/user.repository");
    repo.findReachableUsersByTimezone.mockResolvedValueOnce([
      { _id: "u1", streaks: { journal: { current: 12, lastQualifyingDate: "2026-09-01" }, timezone: "Asia/Kolkata" } },
    ]);
    await runStreakProtectorJob(SATURDAY_2100_IST);
    expect(sendAtRisk).not.toHaveBeenCalled();
  });

  it("does not nudge when today is already the last qualifying date", async () => {
    const repo = require("../../repositories/user.repository");
    repo.findReachableUsersByTimezone.mockResolvedValueOnce([
      { _id: "u1", streaks: { journal: { current: 5, lastQualifyingDate: "2026-09-19" }, timezone: "Asia/Kolkata" } },
    ]);
    await runStreakProtectorJob(SATURDAY_2100_IST);
    expect(sendAtRisk).not.toHaveBeenCalled();
  });
});
