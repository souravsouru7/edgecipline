jest.mock("../../config", () => ({
  appConfig: { timezoneOffsetHours: 0 },
}));

jest.mock("../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../services/geminiService", () => ({
  generateWeeklyFeedback: jest.fn(),
}));

jest.mock("../../services/missionProgressService", () => ({
  onWeeklyReportSaved: jest.fn(),
}));

jest.mock("../../services/analyticsSnapshotService", () => ({
  getSnapshot: jest.fn(),
  generateSnapshotFromTrades: jest.fn(),
}));

jest.mock("../../services/smartNotificationEvaluator", () => ({
  notifyWeeklyInsight: jest.fn(),
}));

jest.mock("../../utils/cacheUtils", () => ({
  getTradeCacheVersion: jest.fn(),
}));

jest.mock("../../repositories/weeklyReport.repository", () => ({
  findWeeklyReportByIdAndUser: jest.fn(),
  findWeeklyReportsByUser: jest.fn(),
  findRecentlyGeneratedWeeklyReport: jest.fn(),
  updateWeeklyReportById: jest.fn(),
  upsertRollingWeeklyReport: jest.fn(),
}));

const weeklyReportRepository = require("../../repositories/weeklyReport.repository");
const weeklyReportService = require("../../services/weeklyReport.service");

describe("weekly report ownership boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists weekly reports through the authenticated user's scope", async () => {
    const reports = [{ _id: "report-a", user: "user-a" }];
    weeklyReportRepository.findWeeklyReportsByUser.mockResolvedValue(reports);

    const result = await weeklyReportService.listWeeklyReports("user-a", "Forex", "999");

    expect(result).toBe(reports);
    expect(weeklyReportRepository.findWeeklyReportsByUser).toHaveBeenCalledWith(
      "user-a",
      "Forex",
      50
    );
  });

  it("returns a generic 404 when a report ID is not owned by the user", async () => {
    weeklyReportRepository.findWeeklyReportByIdAndUser.mockResolvedValue(null);

    await expect(weeklyReportService.getWeeklyReport("user-b", "report-a"))
      .rejects.toMatchObject({
        statusCode: 404,
        errorCode: "NOT_FOUND",
        message: "Report not found",
      });

    expect(weeklyReportRepository.findWeeklyReportByIdAndUser).toHaveBeenCalledWith(
      "report-a",
      "user-b"
    );
  });
});
