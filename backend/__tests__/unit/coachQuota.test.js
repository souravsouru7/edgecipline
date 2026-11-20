jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn(),
}));

jest.mock("../../config/redis", () => ({
  client: { get: jest.fn(), set: jest.fn(), incr: jest.fn(), decr: jest.fn(), expire: jest.fn() },
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

describe("coachQuotaService quota counting excludes refunded turns", () => {
  beforeEach(() => jest.clearAllMocks());

  it("counts only billable, non-superseded user turns", async () => {
    CoachMessage.countDocuments.mockResolvedValue(1);
    await coachQuotaService.getQuota({ _id: "user-1", subscriptionPlan: "free" });

    const filter = CoachMessage.countDocuments.mock.calls[0][0];
    expect(filter.role).toBe("user");
    // A question whose reply died upstream was refunded and must not count.
    expect(filter.billable).toEqual({ $ne: false });
    // Nor may a question the user retried.
    expect(filter.superseded).toEqual({ $ne: true });
  });
});

describe("coachQuotaService.refundUsage", () => {
  const { client: redis, isRedisReady } = require("../../config/redis");
  const user = { _id: "user-1" };

  beforeEach(() => jest.clearAllMocks());

  it("decrements the cached counter when Redis is available", async () => {
    isRedisReady.mockReturnValue(true);
    redis.decr.mockResolvedValue(2);
    await expect(coachQuotaService.refundUsage(user)).resolves.toBe(2);
    expect(redis.decr).toHaveBeenCalledTimes(1);
  });

  it("floors at zero so a refund racing a week rollover can't hand out a sixth question", async () => {
    isRedisReady.mockReturnValue(true);
    redis.decr.mockResolvedValue(-1);
    await expect(coachQuotaService.refundUsage(user)).resolves.toBe(0);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), "0", "EX", expect.any(Number));
  });

  it("is a no-op without Redis, since Mongo is the authority", async () => {
    isRedisReady.mockReturnValue(false);
    await expect(coachQuotaService.refundUsage(user)).resolves.toBeNull();
    expect(redis.decr).not.toHaveBeenCalled();
  });

  it("never throws when Redis errors mid-refund", async () => {
    isRedisReady.mockReturnValue(true);
    redis.decr.mockRejectedValue(new Error("connection lost"));
    await expect(coachQuotaService.refundUsage(user)).resolves.toBeNull();
  });
});

describe("premium daily fair-use cap", () => {
  const { client: redis, isRedisReady } = require("../../config/redis");
  const coachChatService = require("../../services/coachChatService");
  const premiumUser = { _id: "user-p", subscriptionStatus: "active", subscriptionPlan: "yearly" };
  const freeUser = { _id: "user-f", subscriptionStatus: "inactive", subscriptionPlan: "free" };

  beforeEach(() => {
    jest.clearAllMocks();
    isRedisReady.mockReturnValue(false);
  });

  it("reports a daily allowance for premium and keeps the weekly limit null for old apps", async () => {
    CoachMessage.countDocuments.mockResolvedValue(3);
    const quota = await coachQuotaService.getQuota(premiumUser);
    expect(quota.limit).toBeNull();
    expect(quota.daily).toEqual(expect.objectContaining({
      limit: coachQuotaService.PREMIUM_DAILY_LIMIT,
      used: 3,
      remaining: coachQuotaService.PREMIUM_DAILY_LIMIT - 3,
    }));
  });

  it("does not add a daily block (or query) for free users", async () => {
    CoachMessage.countDocuments.mockResolvedValue(1);
    const quota = await coachQuotaService.getQuota(freeUser);
    expect(quota.daily).toBeUndefined();
    expect(CoachMessage.countDocuments).toHaveBeenCalledTimes(1);
  });

  it("blocks a premium user at the daily cap with COACH_DAILY_LIMIT, not the upgrade code", async () => {
    CoachMessage.countDocuments.mockResolvedValue(coachQuotaService.PREMIUM_DAILY_LIMIT);
    await expect(coachChatService.enforceAndCountQuota(premiumUser)).rejects.toMatchObject({
      statusCode: 402,
      errorCode: "COACH_DAILY_LIMIT",
    });
  });

  it("lets a premium user under the cap through", async () => {
    CoachMessage.countDocuments.mockResolvedValue(2);
    await expect(coachChatService.enforceAndCountQuota(premiumUser)).resolves.toEqual(
      expect.objectContaining({ newCount: 3 })
    );
  });

  it("rejects and refunds when a parallel request pushes the Redis counter past the cap", async () => {
    isRedisReady.mockReturnValue(true);
    redis.get.mockResolvedValue(String(coachQuotaService.PREMIUM_DAILY_LIMIT - 1));
    redis.incr.mockResolvedValue(coachQuotaService.PREMIUM_DAILY_LIMIT + 1);
    redis.decr.mockResolvedValue(coachQuotaService.PREMIUM_DAILY_LIMIT);
    await expect(coachChatService.enforceAndCountQuota(premiumUser)).rejects.toMatchObject({
      errorCode: "COACH_DAILY_LIMIT",
    });
    expect(redis.decr).toHaveBeenCalledWith(expect.stringContaining("coach:quota:day:user-p:"));
  });

  it("keeps the free weekly message in sync with the configured limit", async () => {
    CoachMessage.countDocuments.mockResolvedValue(coachQuotaService.FREE_WEEKLY_LIMIT);
    await expect(coachChatService.enforceAndCountQuota(freeUser)).rejects.toMatchObject({
      errorCode: "COACH_QUOTA_EXHAUSTED",
      message: expect.stringContaining(`${coachQuotaService.FREE_WEEKLY_LIMIT} free coach questions`),
    });
  });
});
