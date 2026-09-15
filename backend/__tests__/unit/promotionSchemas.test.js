"use strict";

const { adminPromotionSchemas } = require("../../validation/promotionSchemas");

describe("adminPromotionSchemas.createCampaign", () => {
  test("accepts a named campaign", () => {
    const result = adminPromotionSchemas.createCampaign.safeParse({
      body: { name: "Diwali 2026", type: "festival", status: "active" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(true);
  });

  test("rejects a blank name", () => {
    const result = adminPromotionSchemas.createCampaign.safeParse({
      body: { name: "   ", type: "general", status: "active" },
      query: {},
      params: {},
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(["body", "name"]);
  });
});

describe("adminPromotionSchemas.createCoupon", () => {
  test("rejects an empty campaignId", () => {
    const result = adminPromotionSchemas.createCoupon.safeParse({
      body: {
        code: "SAVE20",
        campaignId: "",
        discountType: "percent",
        discountValue: 20,
      },
      query: {},
      params: {},
    });
    expect(result.success).toBe(false);
  });
});

// Audit follow-ups: strict numbers, whole-rupee fixed discounts, ordered windows.
describe("adminPromotionSchemas.createCoupon rules", () => {
  const base = { code: "SAVE20", campaignId: "507f1f77bcf86cd7994390aa", discountType: "percent", discountValue: 20 };
  const parse = (body) => adminPromotionSchemas.createCoupon.safeParse({ body, query: {}, params: {} });
  const fail = (body) => expect(parse(body).success).toBe(false);

  test("rejects non-numeric discount values instead of coercing them", () => {
    fail({ ...base, discountValue: true });
    fail({ ...base, discountValue: "20" });
    fail({ ...base, discountValue: Infinity });
  });

  test("fixed discounts must be whole rupees", () => {
    fail({ ...base, discountType: "fixed", discountValue: 0.5 });
    fail({ ...base, discountType: "fixed", discountValue: 100.75 });
    expect(parse({ ...base, discountType: "fixed", discountValue: 100 }).success).toBe(true);
    expect(parse({ ...base, discountValue: 33.333 }).success).toBe(true); // percent may be fractional
  });

  test("rejects a coupon window that ends before, or exactly when, it starts", () => {
    fail({ ...base, startsAt: "2026-12-02T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" });
    fail({ ...base, startsAt: "2026-12-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" });
    expect(parse({ ...base, startsAt: "2026-12-01T00:00:00Z", expiresAt: "2026-12-02T00:00:00Z" }).success).toBe(true);
  });

  test("blank numeric limits from a form are treated as unset", () => {
    const r = parse({ ...base, maxRedemptions: "", maxPerUser: "", minAmount: "" });
    expect(r.success).toBe(true);
    expect(r.data.body.maxRedemptions).toBeUndefined();
  });
});

describe("adminPromotionSchemas.createCampaign window", () => {
  test("rejects endsAt before startsAt", () => {
    const r = adminPromotionSchemas.createCampaign.safeParse({
      body: { name: "X", type: "general", startsAt: "2026-12-02T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" },
      query: {}, params: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("userPromotionSchemas.createOrder", () => {
  const { userPromotionSchemas } = require("../../validation/promotionSchemas");
  const parse = (body) => userPromotionSchemas.createOrder.safeParse({ body, query: {}, params: {} });
  test("accepts the paywall payload and defaults the plan", () => {
    const r = parse({ planType: "monthly", couponCode: "SAVE20" });
    expect(r.success).toBe(true);
    expect(parse({}).data.body.planType).toBe("3_months");
  });
  test("rejects arrays, unknown plans and oversized codes", () => {
    expect(parse({ planType: ["monthly"] }).success).toBe(false);
    expect(parse({ planType: "yearly" }).success).toBe(false);
    expect(parse({ couponCode: ["SAVE20"] }).success).toBe(false);
    expect(parse({ couponCode: "A".repeat(33) }).success).toBe(false);
  });
});

describe("adminPromotionSchemas.updateCoupon dates", () => {
  const parse = (body) => adminPromotionSchemas.updateCoupon.safeParse({ body, query: {}, params: { id: "507f1f77bcf86cd7994390bb" } });
  test("an empty string clears a date, an absent key leaves it alone", () => {
    expect(parse({ expiresAt: "" }).data.body.expiresAt).toBeNull();
    expect(parse({}).data.body.expiresAt).toBeUndefined();
    expect(parse({ expiresAt: "not-a-date" }).success).toBe(false);
  });
});
