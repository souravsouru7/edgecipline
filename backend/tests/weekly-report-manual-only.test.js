/**
 * Tests that weekly reports are now manual-only:
 * 1. server.js runs the lightweight reminder cron (not AI generation)
 * 2. generateNowOnce (manual button) still works correctly
 */
const fs = require("fs");
const path = require("path");

// ─── 1. server.js cron wiring ─────────────────────────────────────────────────
// The weeklyReportsCron sends reminder notifications only — it does NOT call AI.
// Report generation is manual: users click "Generate Report" which calls generateNowOnce.
describe("server.js — cron wiring", () => {
  const serverSrc = fs.readFileSync(
    path.resolve(__dirname, "../server.js"),
    "utf8"
  );

  test("imports and calls the reminder-only weeklyReportsCron", () => {
    expect(serverSrc).toMatch(/startWeeklyReportsCron/);
    expect(serverSrc).toMatch(/startWeeklyReportsCron\s*\(\s*\)/);
  });

  test("imports and calls the morning mentor cron", () => {
    expect(serverSrc).toMatch(/startMorningMentorCron/);
    expect(serverSrc).toMatch(/startMorningMentorCron\s*\(\s*\)/);
  });

  test("registers the /api/reports route", () => {
    expect(serverSrc).toMatch(/['"]\/api\/reports['"]/);
  });

  test("starts the data-cleanup cron", () => {
    expect(serverSrc).toMatch(/startDataCleanupCron\s*\(\s*\)/);
  });
});

// ─── 2. generateNowOnce (manual endpoint) behaves correctly ──────────────────
jest.mock("../config", () => ({
  appConfig: {
    weeklyReports: { enabled: true, schedule: "0 1 * * *" },
    timezoneOffsetHours: 0,
  },
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../repositories/weeklyReport.repository", () => ({
  findRecentlyGeneratedWeeklyReport: jest.fn(),
  upsertRollingWeeklyReport: jest.fn(),
  updateWeeklyReportById: jest.fn(),
  findWeeklyReportsByUser: jest.fn(),
  findWeeklyReportByIdAndUser: jest.fn(),
}));

jest.mock("../repositories/trade.repository", () => ({
  findTradesForWeeklyWindow: jest.fn(),
}));

jest.mock("../repositories/indianTrade.repository", () => ({
  findIndianTradesForWeeklyWindow: jest.fn(),
}));

jest.mock("../services/geminiService", () => ({
  generateWeeklyFeedback: jest.fn(),
}));

const weeklyReportRepository = require("../repositories/weeklyReport.repository");
const tradeRepository = require("../repositories/trade.repository");
const { generateWeeklyFeedback } = require("../services/geminiService");
const { generateNowOnce } = require("../services/weeklyReport.service");

describe("generateNowOnce — manual report generation", () => {
  beforeEach(() => jest.clearAllMocks());

  test("generates a report when no recent report exists", async () => {
    weeklyReportRepository.findRecentlyGeneratedWeeklyReport.mockResolvedValue(null);
    tradeRepository.findTradesForWeeklyWindow.mockResolvedValue([]);

    const mockReport = { _id: "r1", aiFeedback: { summary: "good week" } };
    weeklyReportRepository.upsertRollingWeeklyReport.mockResolvedValue(mockReport);
    weeklyReportRepository.updateWeeklyReportById.mockResolvedValue(mockReport);

    const result = await generateNowOnce("user-1", "Forex");
    expect(result).toBeDefined();
    expect(weeklyReportRepository.upsertRollingWeeklyReport).toHaveBeenCalledTimes(1);
  });

  test("generates if previous report has no psychologyFeedback (backward compat)", async () => {
    const oldReport = { _id: "r1", aiFeedback: { summary: "old", psychologyFeedback: null } };
    weeklyReportRepository.findRecentlyGeneratedWeeklyReport.mockResolvedValue(oldReport);
    tradeRepository.findTradesForWeeklyWindow.mockResolvedValue([]);

    const updatedReport = { _id: "r1", aiFeedback: { summary: "refreshed" } };
    weeklyReportRepository.upsertRollingWeeklyReport.mockResolvedValue(updatedReport);
    weeklyReportRepository.updateWeeklyReportById.mockResolvedValue(updatedReport);

    const result = await generateNowOnce("user-1", "Forex");
    expect(result).toBeDefined();
  });

  test("throws 409 when report with psychologyFeedback already exists this week", async () => {
    const existingReport = {
      _id: "r1",
      aiFeedback: { summary: "done", psychologyFeedback: "stay calm" },
    };
    weeklyReportRepository.findRecentlyGeneratedWeeklyReport.mockResolvedValue(existingReport);

    await expect(generateNowOnce("user-1", "Forex")).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "CONFLICT",
    });

    // Must NOT generate a new report
    expect(weeklyReportRepository.upsertRollingWeeklyReport).not.toHaveBeenCalled();
  });

  test("calls generateWeeklyFeedback when trades exist", async () => {
    weeklyReportRepository.findRecentlyGeneratedWeeklyReport.mockResolvedValue(null);

    const trades = [
      { profit: 100, commission: 2, swap: 0, pair: "EURUSD" },
      { profit: -50, commission: 2, swap: 0, pair: "GBPUSD" },
    ];
    tradeRepository.findTradesForWeeklyWindow.mockResolvedValue(trades);

    const draft = { _id: "r2", aiFeedback: null };
    weeklyReportRepository.upsertRollingWeeklyReport.mockResolvedValue(draft);
    generateWeeklyFeedback.mockResolvedValue({
      model: "gemini-1.5-pro",
      feedback: { summary: "good", mistakes: [], improvements: [], nextWeekChecklist: [] },
    });
    weeklyReportRepository.updateWeeklyReportById.mockResolvedValue({
      ...draft,
      aiFeedback: { summary: "good" },
      aiModel: "gemini-1.5-pro",
    });

    await generateNowOnce("user-1", "Forex");

    expect(generateWeeklyFeedback).toHaveBeenCalledTimes(1);
  });

  test("skips AI call when no trades logged this week", async () => {
    weeklyReportRepository.findRecentlyGeneratedWeeklyReport.mockResolvedValue(null);
    tradeRepository.findTradesForWeeklyWindow.mockResolvedValue([]);

    const draft = { _id: "r3", aiFeedback: null };
    weeklyReportRepository.upsertRollingWeeklyReport.mockResolvedValue(draft);
    weeklyReportRepository.updateWeeklyReportById.mockResolvedValue({
      ...draft,
      aiFeedback: { summary: "No trades logged in the last 7 days" },
    });

    await generateNowOnce("user-1", "Forex");

    expect(generateWeeklyFeedback).not.toHaveBeenCalled();
  });
});
