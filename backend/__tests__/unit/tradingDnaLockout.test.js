jest.mock("../../queues/tradingDnaQueue", () => ({
  enqueueTradingDnaJob: jest.fn().mockResolvedValue({ jobId: "job-1", state: "waiting" }),
  getTradingDnaJobSnapshot: jest.fn(),
}));

jest.mock("../../repositories/tradingDnaReport.repository", () => ({
  findRecentlyGenerated: jest.fn(),
}));

jest.mock("../../utils/cacheUtils", () => ({
  getTradeCacheVersion: jest.fn(),
}));

jest.mock("../../services/analyticsSnapshotService", () => ({}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const repo = require("../../repositories/tradingDnaReport.repository");
const { getTradeCacheVersion } = require("../../utils/cacheUtils");
const { enqueueTradingDnaJob } = require("../../queues/tradingDnaQueue");
const tradingDnaService = require("../../services/tradingDnaService");

const recent = { _id: "r1", dataVersion: "7" };

describe("Trading DNA 24h lockout and force", () => {
  beforeEach(() => jest.clearAllMocks());

  it("blocks a non-forced rebuild inside 24h", async () => {
    repo.findRecentlyGenerated.mockResolvedValue(recent);
    await expect(tradingDnaService.enqueueGeneration({ userId: "u1" })).rejects.toMatchObject({ statusCode: 409 });
    expect(enqueueTradingDnaJob).not.toHaveBeenCalled();
  });

  it("ignores force from a trader whose trades have not changed", async () => {
    repo.findRecentlyGenerated.mockResolvedValue(recent);
    getTradeCacheVersion.mockResolvedValue("7");
    await expect(tradingDnaService.enqueueGeneration({ userId: "u1", force: true })).rejects.toMatchObject({ statusCode: 409 });
    expect(enqueueTradingDnaJob).not.toHaveBeenCalled();
  });

  it("honours force when the trader's trades changed since the report", async () => {
    repo.findRecentlyGenerated.mockResolvedValue(recent);
    getTradeCacheVersion.mockResolvedValue("8");
    await tradingDnaService.enqueueGeneration({ userId: "u1", force: true });
    expect(enqueueTradingDnaJob).toHaveBeenCalledTimes(1);
  });

  it("always honours force for an admin", async () => {
    repo.findRecentlyGenerated.mockResolvedValue(recent);
    getTradeCacheVersion.mockResolvedValue("7");
    await tradingDnaService.enqueueGeneration({ userId: "u1", force: true, isAdmin: true });
    expect(enqueueTradingDnaJob).toHaveBeenCalledTimes(1);
    expect(repo.findRecentlyGenerated).not.toHaveBeenCalled();
  });

  it("allows generation when there is no recent report", async () => {
    repo.findRecentlyGenerated.mockResolvedValue(null);
    await tradingDnaService.enqueueGeneration({ userId: "u1" });
    expect(enqueueTradingDnaJob).toHaveBeenCalledTimes(1);
  });
});

describe("weekly report lockout ignores fallback reports", () => {
  it("excludes fallback / blocked / unavailable aiModel values from the lockout query", async () => {
    jest.isolateModules(() => {
      const findOne = jest.fn(() => ({ sort: () => ({ select: () => null }) }));
      jest.doMock("../../models/WeeklyReport", () => ({ findOne }));
      const weeklyRepo = require("../../repositories/weeklyReport.repository");
      weeklyRepo.findRecentlyGeneratedWeeklyReport("u1", "Forex", new Date());
      const pattern = findOne.mock.calls[0][0].aiModel.$not;
      for (const blocked of ["gemini-3.5-flash-fallback", "gemini-3.5-flash-blocked", "unavailable", "validation-error"]) {
        expect(pattern.test(blocked)).toBe(true);
      }
      expect(pattern.test("gemini-3.5-flash")).toBe(false);
    });
  });
});
