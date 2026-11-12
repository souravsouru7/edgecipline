jest.mock("../../config", () => ({
  appConfig: {
    cron: { weeklyReportsConcurrency: 5, concurrency: 5 },
    weeklyReports: { enabled: true, schedule: "0 9 * * *" },
  },
}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../repositories/user.repository", () => ({ findUsersForSessionReminders: jest.fn() }));
jest.mock("../../services/userMarketService", () => ({ resolveActiveMarketsForUsers: jest.fn() }));
jest.mock("../../models/Trade", () => ({ distinct: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ distinct: jest.fn() }));
jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "n", status: "sent" }),
}));

const userRepository = require("../../repositories/user.repository");
const { resolveActiveMarketsForUsers } = require("../../services/userMarketService");
const notificationService = require("../../services/notificationService");
const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const { runWeeklyReportsJob, sendRemindersForUser } = require("../../jobs/weeklyReportsCron");

function sent() {
  return notificationService.notifyUser.mock.calls.map(([u, p]) => `${u}:${p.data.marketType}:${p.deepLink}`).sort();
}

describe("weeklyReportsCron market gating", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Everyone traded in both markets this week unless a test says otherwise.
    Trade.distinct.mockResolvedValue(["fx", "both", "none"]);
    IndianTrade.distinct.mockResolvedValue(["in", "both", "none"]);
  });

  it("skips a market the user did not trade in during the last 7 days", async () => {
    userRepository.findUsersForSessionReminders.mockResolvedValue([{ _id: "both" }]);
    resolveActiveMarketsForUsers.mockResolvedValue(new Map([["both", new Set(["Forex", "Indian_Market"])]]));
    Trade.distinct.mockResolvedValue([]);              // no Forex trades this week
    IndianTrade.distinct.mockResolvedValue(["both"]);
    await runWeeklyReportsJob();
    expect(sent()).toEqual(["both:Indian_Market:/weekly-reports?market=Indian_Market"]);
  });

  it("sends one reminder per active market with the matching route", async () => {
    userRepository.findUsersForSessionReminders.mockResolvedValue([{ _id: "fx" }, { _id: "in" }, { _id: "both" }, { _id: "none" }]);
    resolveActiveMarketsForUsers.mockResolvedValue(new Map([
      ["fx", new Set(["Forex"])],
      ["in", new Set(["Indian_Market"])],
      ["both", new Set(["Forex", "Indian_Market"])],
      ["none", new Set()],
    ]));
    await runWeeklyReportsJob();
    expect(sent()).toEqual([
      "both:Forex:/weekly-reports?market=Forex",
      "both:Indian_Market:/weekly-reports?market=Indian_Market",
      "fx:Forex:/weekly-reports?market=Forex",
      "in:Indian_Market:/weekly-reports?market=Indian_Market",
    ]);
  });

  it("dedupes per user + market + ISO week", async () => {
    await sendRemindersForUser({ _id: "u" }, "2026-09-21", new Set(["Indian_Market"]));
    expect(notificationService.notifyUser).toHaveBeenCalledWith("u", expect.objectContaining({
      type: "weekly_report_reminder",
      dedupeKey: "weekly-report-reminder:u:Indian_Market:2026-09-21",
    }));
  });

  it("throws when a market reminder fails so cron metrics count it", async () => {
    notificationService.notifyUser.mockRejectedValueOnce(new Error("fcm"));
    await expect(sendRemindersForUser({ _id: "u" }, "w", new Set(["Forex", "Indian_Market"])))
      .rejects.toThrow("weekly reminder failed for 1/2 markets");
  });
});
