describe("trade cache invalidation", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setup({ redisReady = true, version = 15 } = {}) {
    const client = {
      get: jest.fn().mockResolvedValue(String(version)),
      incr: jest.fn().mockResolvedValue(version + 1),
    };

    jest.doMock("../../config/redis", () => ({
      client,
      isRedisReady: jest.fn(() => redisReady),
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
      },
    }));

    return {
      client,
      logger: require("../../utils/logger").logger,
      cacheUtils: require("../../utils/cacheUtils"),
    };
  }

  test("reads the current trade cache version from Redis", async () => {
    const { client, cacheUtils } = setup({ version: 7 });

    await expect(cacheUtils.getTradeCacheVersion("user-1")).resolves.toBe("7");
    expect(client.get).toHaveBeenCalledWith("trade_version:user-1");
  });

  test("trade lifecycle invalidation advances one user version without wildcard deletes", async () => {
    const { client, logger, cacheUtils } = setup({ version: 20 });

    const nextVersion = await cacheUtils.invalidateTradeCaches({
      userId: "user-1",
      event: cacheUtils.TRADE_CACHE_EVENTS.EDIT,
      market: "Forex",
      tradeId: "trade-1",
      source: "manual_edit",
    });

    expect(nextVersion).toBe(21);
    expect(client.incr).toHaveBeenCalledWith("trade_version:user-1");
    expect(client.get).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Advanced user trade cache version",
      expect.objectContaining({
        userId: "user-1",
        version: 21,
        event: "edit",
        market: "Forex",
        tradeId: "trade-1",
      })
    );
  });

  test("legacy clearUserCache delegates to version invalidation", async () => {
    const { client, cacheUtils } = setup({ version: 3 });

    await expect(cacheUtils.clearUserCache("user-1")).resolves.toBe(4);
    expect(client.incr).toHaveBeenCalledWith("trade_version:user-1");
  });

  test("Redis outage bypasses cache versioning safely", async () => {
    const { client, cacheUtils } = setup({ redisReady: false });

    await expect(cacheUtils.getTradeCacheVersion("user-1")).resolves.toBe("0");
    await expect(cacheUtils.invalidateTradeCaches({
      userId: "user-1",
      event: cacheUtils.TRADE_CACHE_EVENTS.DELETE,
    })).resolves.toBe(0);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.incr).not.toHaveBeenCalled();
  });
});
