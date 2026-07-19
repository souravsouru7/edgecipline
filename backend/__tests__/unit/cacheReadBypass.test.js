describe("cache read bypass", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("does not read stale cached responses while Redis writes are unavailable", async () => {
    const client = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ totalTrades: 0 })),
      set: jest.fn(),
    };

    jest.doMock("../../config/redis", () => ({
      client,
      isRedisReady: jest.fn(() => true),
      isRedisWriteAvailable: jest.fn(() => false),
      markRedisWriteFailure: jest.fn(),
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn() },
    }));

    const { getCache, setCache } = require("../../utils/cache");

    await expect(getCache("dashboard:user:stale")).resolves.toBeNull();
    await expect(setCache("dashboard:user:stale", { totalTrades: 2 }, 45)).resolves.toBe(false);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });
});
