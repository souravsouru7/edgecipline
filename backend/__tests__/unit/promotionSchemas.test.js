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
