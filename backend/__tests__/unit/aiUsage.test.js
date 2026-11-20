jest.mock("../../models/AiUsage", () => ({ create: jest.fn() }));

jest.mock("../../config/redis", () => ({
  client: { incrby: jest.fn(), expire: jest.fn(), get: jest.fn() },
  isRedisReady: jest.fn(() => true),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/geminiCircuit", () => ({
  alertOnce: jest.fn().mockResolvedValue(true),
}));

const AiUsage = require("../../models/AiUsage");
const { client: redis } = require("../../config/redis");
const { appConfig } = require("../../config");
const aiUsage = require("../../utils/aiUsage");

describe("aiUsage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads token counts from usageMetadata", () => {
    expect(aiUsage.readUsageMetadata({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 },
    })).toEqual({ inputTokens: 100, outputTokens: 20, thinkingTokens: 5, totalTokens: 125 });
  });

  it("treats a missing usageMetadata as zero instead of throwing", () => {
    expect(aiUsage.readUsageMetadata(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 });
  });

  it("persists a row and bumps the daily Redis counter", async () => {
    AiUsage.create.mockResolvedValue({});
    redis.incrby.mockResolvedValue(125);
    await aiUsage.recordAiUsage({
      userId: "u1",
      feature: "coach",
      model: "m",
      response: { usageMetadata: { totalTokenCount: 125 } },
    });
    expect(AiUsage.create).toHaveBeenCalledWith(expect.objectContaining({ feature: "coach", totalTokens: 125, ok: true }));
    expect(redis.incrby).toHaveBeenCalledWith(expect.stringMatching(/^ai:tokens:\d{4}-\d{2}-\d{2}$/), 125);
    expect(redis.expire).toHaveBeenCalled();
  });

  it("never rejects when the database write fails", async () => {
    AiUsage.create.mockRejectedValue(new Error("mongo down"));
    await expect(aiUsage.recordAiUsage({ feature: "coach" })).resolves.toBeUndefined();
  });

  describe("isOverDailyBudget", () => {
    const original = appConfig.ai.dailyTokenBudget;
    afterEach(() => { appConfig.ai.dailyTokenBudget = original; });

    it("is off when no budget is configured", async () => {
      appConfig.ai.dailyTokenBudget = 0;
      redis.get.mockResolvedValue("999999999");
      await expect(aiUsage.isOverDailyBudget()).resolves.toBe(false);
    });

    it("trips only once spend passes the budget", async () => {
      appConfig.ai.dailyTokenBudget = 1000;
      redis.get.mockResolvedValue("900");
      await expect(aiUsage.isOverDailyBudget()).resolves.toBe(false);
      redis.get.mockResolvedValue("1001");
      await expect(aiUsage.isOverDailyBudget()).resolves.toBe(true);
    });

    it("counts as under budget when Redis can't be read", async () => {
      appConfig.ai.dailyTokenBudget = 1000;
      redis.get.mockRejectedValue(new Error("down"));
      await expect(aiUsage.isOverDailyBudget()).resolves.toBe(false);
    });
  });
});
