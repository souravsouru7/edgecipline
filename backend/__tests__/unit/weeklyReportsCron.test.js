jest.mock("../../config", () => ({
  appConfig: {
    cron: { weeklyReportsConcurrency: 5, concurrency: 5 },
    weeklyReports: { enabled: true, schedule: "0 9 * * *" },
  },
}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../repositories/user.repository", () => ({ findUsersForSessionReminders: jest.fn() }));
jest.mock("../../services/userMarketService", () => ({ resolveActiveMarketsForUsers: jest.fn() }));
jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "n", status: "sent" }),
}));

const userRepository = require("../../repositories/user.repository");
const { resolveActiveMarketsForUsers } = require("../../services/userMarketService");
const notificationService = require("../../services/notificationService");
const { runWeeklyReportsJob, sendRemindersForUser } = require("../../jobs/weeklyReportsCron");

function sent() {
  return notificationService.notifyUser.mock.calls.map(([u, p]) => `${u}:${p.data.marketType}:${p.deepLink}`).sort();
}

describe("weeklyReportsCron market gating", () => {
  beforeEach(() => jest.clearAllMocks());

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
      "both:Forex:/weekly-reports?marketType=Forex",
      "both:Indian_Market:/weekly-reports?marketType=Indian_Market",
      "fx:Forex:/weekly-reports?marketType=Forex",
      "in:Indian_Market:/weekly-reports?marketType=Indian_Market",
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
