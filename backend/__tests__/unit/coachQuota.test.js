jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn(),
}));

jest.mock("../../config/redis", () => ({
  client: { get: jest.fn(), set: jest.fn(), incr: jest.fn(), expire: jest.fn() },
  isRedisReady: jest.fn(() => false),
}));

jest.mock("../../models/CoachMessage", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const CoachMessage = require("../../models/CoachMessage");
const coachQuotaService = require("../../services/coachQuotaService");
const { isPremium } = require("../../utils/premium");

describe("isPremium", () => {
  it("returns true for active monthly plan", () => {
    expect(isPremium({ subscriptionStatus: "active", subscriptionPlan: "monthly" })).toBe(true);
  });

  it("returns true for admins regardless of plan", () => {
    expect(isPremium({ role: "admin", subscriptionStatus: "inactive", subscriptionPlan: "free" })).toBe(true);
  });

  it("returns false for free or expired plans", () => {
    expect(isPremium({ subscriptionStatus: "active", subscriptionPlan: "free" })).toBe(false);
    expect(isPremium({ subscriptionStatus: "expired", subscriptionPlan: "monthly" })).toBe(false);
  });

  it("returns false when subscriptionExpiry has passed even if status is active", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isPremium({
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionExpiry: yesterday,
    })).toBe(false);
  });
});

describe("coachQuotaService.getQuota", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the free-tier quota with remaining when usage is below the cap", async () => {
    CoachMessage.countDocuments.mockResolvedValue(2);
    const quota = await coachQuotaService.getQuota({ _id: "user-1", subscriptionStatus: "inactive", subscriptionPlan: "free" });
    expect(quota.premium).toBe(false);
    expect(quota.used).toBe(2);
    expect(quota.limit).toBe(coachQuotaService.FREE_WEEKLY_LIMIT);
    expect(quota.remaining).toBe(3);
    expect(quota.weekKey).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("clamps remaining at zero once usage hits the cap", async () => {
    CoachMessage.countDocuments.mockResolvedValue(7);
    const quota = await coachQuotaService.getQuota({ _id: "user-2", subscriptionStatus: "inactive", subscriptionPlan: "free" });
    expect(quota.remaining).toBe(0);
  });

  it("returns unlimited (null) for premium users", async () => {
    CoachMessage.countDocuments.mockResolvedValue(50);
    const quota = await coachQuotaService.getQuota({ _id: "user-3", subscriptionStatus: "active", subscriptionPlan: "yearly" });
    expect(quota.premium).toBe(true);
    expect(quota.limit).toBeNull();
    expect(quota.remaining).toBeNull();
    expect(quota.used).toBe(50);
  });
});
