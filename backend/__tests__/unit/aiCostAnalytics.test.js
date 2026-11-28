jest.mock("../../models/AiUsage", () => ({
  aggregate: jest.fn(),
  distinct: jest.fn(),
  FEATURES: ["coach", "trade_vision"],
}));
jest.mock("../../models/Users", () => ({ find: jest.fn() }));

const AiUsage = require("../../models/AiUsage");
const User = require("../../models/Users");
const svc = require("../../services/aiCostAnalyticsService");

describe("aiCostAnalyticsService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clamps the range to 180 days and defaults to the last 30", () => {
    const now = new Date("2026-11-28T12:00:00Z");
    const def = svc.parseRange({}, now);
    expect((def.end - def.start) / 86400000).toBeCloseTo(30, 5);
    const wide = svc.parseRange({ from: "2020-01-01", to: "2026-11-28" }, now);
    expect((wide.end - wide.start) / 86400000).toBeLessThanOrEqual(180.0001);
    expect(wide.end.toISOString()).toBe("2026-11-28T23:59:59.999Z");
  });

  it("counts Play, App Store and web subscribers as paying, never admins", () => {
    const f = svc.payingUserFilter(new Date("2026-11-28"));
    expect(f.role).toEqual({ $ne: "admin" });
    expect(f.$or).toHaveLength(3);
  });

  it("computes per-user and per-payer averages from the aggregates", async () => {
    User.find.mockReturnValue({ lean: () => Promise.resolve([{ _id: "p1" }, { _id: "p2" }]) });
    AiUsage.distinct.mockResolvedValue(["u1", "u2", "u3", "u4"]);
    const totals = [{ _id: null, requests: 10, costUsd: 2, meteredUsd: 1.5, estimatedUsd: 0.5 }];
    AiUsage.aggregate.mockImplementation(async (pipeline) => {
      const first = pipeline[0].$match || {};
      const group = pipeline[1]?.$group;
      if (first.operationId) return [{ _id: null, operations: 4, costUsd: 0.04, requests: 6 }];
      if (first.user && first.user.$in) return [{ _id: null, requests: 4, costUsd: 1 }];
      if (group && group._id === null) return totals;
      if (group && group._id === "$feature") return [{ _id: "coach", requests: 10, costUsd: 2 }];
      return [];
    });

    const out = await svc.getCostAnalytics({}, new Date("2026-11-28T12:00:00Z"));
    expect(out.totals).toMatchObject({ requests: 10, costUsd: 2, meteredUsd: 1.5, estimatedUsd: 0.5, avgCostPerRequestUsd: 0.2 });
    expect(out.activeUsers).toBe(4);
    expect(out.avgCostPerActiveUserUsd).toBeCloseTo(0.5);
    expect(out.payingSubscribers).toBe(2);
    expect(out.avgCostPerPayingSubscriberUsd).toBeCloseTo(0.5);
    expect(out.extraction).toMatchObject({ operations: 4, avgRequestsPerOperation: 1.5 });
    expect(out.extraction.avgCostUsd).toBeCloseTo(0.01);
    expect(out.byFeature[0]).toMatchObject({ feature: "coach", costUsd: 2 });
    expect(out.note).toMatch(/not read from Google's invoice/);
  });

  it("returns zeros, not NaN, when there is no data", async () => {
    User.find.mockReturnValue({ lean: () => Promise.resolve([]) });
    AiUsage.distinct.mockResolvedValue([]);
    AiUsage.aggregate.mockResolvedValue([]);
    const out = await svc.getCostAnalytics({});
    expect(out.avgCostPerActiveUserUsd).toBe(0);
    expect(out.avgCostPerPayingSubscriberUsd).toBe(0);
    expect(out.totals.avgCostPerRequestUsd).toBe(0);
  });
});
