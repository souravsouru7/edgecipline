const pricing = require("../../config/aiPricing");

describe("aiPricing", () => {
  it("bills the deprecated gemini-3.5-flash alias at gemini-3.6-flash rates", () => {
    expect(pricing.normalizeModel("gemini-3.5-flash")).toBe("gemini-3.6-flash");
    expect(pricing.normalizeModel("models/gemini-3.6-flash-001")).toBe("gemini-3.6-flash");
  });

  it("uses the December 2026 rate before 2027 and the doubled rate after", () => {
    const tokens = { model: "gemini-3.6-flash", inputTokens: 1_000_000, outputTokens: 0 };
    expect(pricing.estimateCost({ ...tokens, at: new Date("2026-12-31T23:00:00Z") }).usd).toBeCloseTo(0.75, 8);
    expect(pricing.estimateCost({ ...tokens, at: new Date("2027-01-01T00:00:00Z") }).usd).toBeCloseTo(1.5, 8);
  });

  it("bills thinking tokens at the output rate", () => {
    const at = new Date("2026-11-28");
    const a = pricing.estimateCost({ model: "gemini-3.6-flash", outputTokens: 1000, at });
    const b = pricing.estimateCost({ model: "gemini-3.6-flash", thinkingTokens: 1000, at });
    expect(a.usd).toBeCloseTo(b.usd, 10);
    expect(a.usd).toBeCloseTo(0.00375, 10);
  });

  it("bills cached input tokens at the cached rate, out of the input count", () => {
    const at = new Date("2026-11-28");
    const cost = pricing.estimateCost({ model: "gemini-3.6-flash", inputTokens: 10_000, cachedTokens: 8_000, at });
    // 2,000 at $0.75 + 8,000 at $0.075 per 1M
    expect(cost.usd).toBeCloseTo((2000 * 0.75 + 8000 * 0.075) / 1e6, 10);
  });

  it("marks an unknown model as unpriced instead of guessing", () => {
    const cost = pricing.estimateCost({ model: "some-new-model", inputTokens: 1000 });
    expect(cost).toMatchObject({ usd: 0, priced: false });
  });

  it("converts to INR with the configured rate", () => {
    const original = process.env.AI_USD_INR;
    process.env.AI_USD_INR = "80";
    try {
      const cost = pricing.estimateCost({ model: "gemini-3.5-flash-lite", inputTokens: 1_000_000 });
      expect(cost.inr).toBeCloseTo(0.3 * 80, 6);
    } finally {
      if (original === undefined) delete process.env.AI_USD_INR;
      else process.env.AI_USD_INR = original;
    }
  });

  it("prices Cloud Vision per unit", () => {
    expect(pricing.visionCost(2).usd).toBeCloseTo(0.003, 10);
  });

  it("stamps the pricing version on every result", () => {
    expect(pricing.estimateCost({ model: "gemini-3.6-flash" }).pricingVersion).toBe(pricing.PRICING_VERSION);
  });
});

describe("geminiConfig.modelFor", () => {
  const { appConfig } = require("../../config");
  const { modelFor, withThinkingBudget } = require("../../utils/geminiConfig");
  const saved = { ...appConfig.ai.featureModels };
  afterEach(() => { appConfig.ai.featureModels = { ...saved }; });

  it("falls back to the existing models when no override is set", () => {
    appConfig.ai.featureModels = {};
    expect(modelFor("trade_vision")).toBe(appConfig.ai.geminiTradeModel);
    expect(modelFor("trade_text")).toBe(appConfig.ai.geminiTradeModel);
    expect(modelFor("coach")).toBe(appConfig.ai.geminiModel);
    expect(modelFor("reflection")).toBe(appConfig.ai.geminiModel);
  });

  it("uses a per-feature override", () => {
    appConfig.ai.featureModels = { reflection: "gemini-3.5-flash-lite" };
    expect(modelFor("reflection")).toBe("gemini-3.5-flash-lite");
    expect(modelFor("coach")).toBe(appConfig.ai.geminiModel);
  });

  it("adds a thinking cap only for models that accept one", () => {
    expect(withThinkingBudget("gemini-3.6-flash", { a: 1 }, 0)).toEqual({ a: 1, thinkingConfig: { thinkingBudget: 0 } });
    expect(withThinkingBudget("gemini-1.5-flash", { a: 1 }, 0)).toEqual({ a: 1 });
    // Flash-Lite rejects thinkingBudget 0 (400); it doesn't think by default.
    expect(withThinkingBudget("gemini-3.5-flash-lite", { a: 1 }, 0)).toEqual({ a: 1 });
    expect(withThinkingBudget("gemini-3.5-flash-lite", { a: 1 }, 512)).toEqual({ a: 1, thinkingConfig: { thinkingBudget: 512 } });
  });
});
