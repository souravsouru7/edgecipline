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

describe("aiUsage cost rows", () => {
  beforeEach(() => jest.clearAllMocks());

  it("prices a call from provider usage and records the served model and cached tokens", () => {
    const row = aiUsage.buildRow({
      userId: "u1",
      feature: "coach",
      model: "gemini-3.5-flash",
      response: {
        modelVersion: "gemini-3.6-flash",
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50, cachedContentTokenCount: 400, totalTokenCount: 1150 },
      },
    });
    expect(row).toMatchObject({
      model: "gemini-3.5-flash",
      servedModel: "gemini-3.6-flash",
      inputTokens: 1000,
      cachedTokens: 400,
      costSource: "metered",
    });
    expect(row.costUsd).toBeGreaterThan(0);
    expect(row.pricingVersion).toBeTruthy();
  });

  it("labels a call without provider usage as estimated", () => {
    const row = aiUsage.buildRow({
      feature: "trade_vision",
      model: "gemini-3.6-flash",
      ok: false,
      aborted: true,
      estimatedTokens: { inputTokens: 2000 },
    });
    expect(row).toMatchObject({ costSource: "estimated", aborted: true, inputTokens: 2000, ok: false });
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it("prices Cloud Vision by unit", () => {
    const row = aiUsage.buildRow({ feature: "ocr_vision", model: "cloud-vision", units: 2 });
    expect(row).toMatchObject({ costSource: "unit", totalTokens: 0 });
    expect(row.costUsd).toBeCloseTo(0.003, 8);
  });

  it("reads OpenAI usage", () => {
    expect(aiUsage.readOpenAiUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
      .toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedTokens: 0 });
  });

  it("raises a spend alert past the daily threshold but never throws", async () => {
    const { alertOnce } = require("../../utils/geminiCircuit");
    const original = appConfig.ai.spendAlerts;
    appConfig.ai.spendAlerts = { dailyUsd: 1, userDailyUsd: 0 };
    try {
      AiUsage.create.mockResolvedValue({});
      redis.incrby.mockResolvedValueOnce(100).mockResolvedValueOnce(2_000_000).mockResolvedValueOnce(5);
      await aiUsage.recordAiUsage({
        userId: "u1",
        feature: "coach",
        model: "gemini-3.6-flash",
        response: { usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 50, totalTokenCount: 100 } },
      });
      expect(alertOnce).toHaveBeenCalledWith("ai_daily_spend", "AI_DAILY_SPEND_ALERT", expect.any(Object));
    } finally {
      appConfig.ai.spendAlerts = original;
    }
  });
});
