jest.mock("../../config", () => ({
  appConfig: {
    cron: { sessionReminderConcurrency: 10, concurrency: 10 },
    sessionReminders: {
      enabled: true,
      schedule: "*/15 * * * *",
      timezone: "Asia/Kolkata",
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../repositories/user.repository", () => ({
  findUsersForWeeklyReports: jest.fn(),
}));

jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "notif-1", status: "sent" }),
}));

const userRepository = require("../../repositories/user.repository");
const notificationService = require("../../services/notificationService");
const { getDueSessions, runSessionReminderJob } = require("../../jobs/sessionReminderCron");

describe("sessionReminderCron", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("detects London Open reminder at 12:45 IST", () => {
    const now = new Date("2026-06-13T07:15:00.000Z");

    expect(getDueSessions(now, "Asia/Kolkata").map((session) => session.id)).toEqual(["london_open"]);
  });

  it("sends one deduped session_reminder per due session and user", async () => {
    const now = new Date("2026-06-13T07:15:00.000Z");
    userRepository.findUsersForWeeklyReports.mockResolvedValue([{ _id: "user-1" }, { _id: "user-2" }]);

    await runSessionReminderJob(now);

    expect(notificationService.notifyUser).toHaveBeenCalledTimes(2);
    expect(notificationService.notifyUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "session_reminder",
        dedupeKey: "session-reminder:user-1:Forex:london_open:2026-06-13",
        deepLink: "/trades?session=London",
      })
    );
  });

  it("does not fetch users when no session is due", async () => {
    const now = new Date("2026-06-13T07:00:00.000Z");

    await runSessionReminderJob(now);

    expect(userRepository.findUsersForWeeklyReports).not.toHaveBeenCalled();
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });
});
