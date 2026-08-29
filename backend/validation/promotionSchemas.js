"use strict";

const { z } = require("zod");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid ObjectId");
const emptyToUndefined = (value) => (value === "" || value === null ? undefined : value);
const optionalObjectId = z.preprocess(emptyToUndefined, objectId.optional());
const emptyBody = z.preprocess((v) => v ?? {}, z.object({}).passthrough());
const emptyQuery = z.preprocess((v) => v ?? {}, z.object({}).passthrough());
const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), "Must be a valid date")
    .optional()
);

const campaignType = z.enum(["influencer", "festival", "general", "new_user", "other"]);
const campaignStatus = z.enum(["draft", "active", "paused", "ended"]);
const couponStatus = z.enum(["active", "disabled"]);
const discountType = z.enum(["percent", "fixed"]);
const planType = z.enum(["monthly", "3_months", "6_months"]);
const influencerStatus = z.enum(["active", "inactive"]);

const metricsQuery = z
  .object({
    from: optionalDate,
    to: optionalDate,
    campaignId: optionalObjectId,
    influencerId: optionalObjectId,
    couponId: optionalObjectId,
    planType: planType.optional(),
    status: z.enum(["applied", "reversed"]).optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  })
  .passthrough();

const userPromotionSchemas = {
  validateCoupon: z.object({
    body: z.object({
      code: z.string().trim().min(1).max(32),
      planType: planType.default("3_months"),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  createOrder: z.object({
    body: z.object({
      planType: planType.default("3_months"),
      couponCode: z.string().trim().max(32).optional(),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  recordTouch: z.object({
    body: z.object({
      ref: z.string().trim().max(64).optional(),
      utmSource: z.string().trim().max(80).optional(),
      utmMedium: z.string().trim().max(80).optional(),
      utmCampaign: z.string().trim().max(80).optional(),
      landingPath: z.string().trim().max(200).optional(),
      anonymousId: z.string().trim().max(80).optional(),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  refRedirect: z.object({
    body: emptyBody,
    query: emptyQuery,
    params: z.object({ slug: z.string().trim().min(1).max(64) }),
  }),
};

const adminPromotionSchemas = {
  list: z.object({ body: emptyBody, query: metricsQuery, params: emptyQuery }),
  overview: z.object({ body: emptyBody, query: metricsQuery, params: emptyQuery }),
  idParams: z.object({
    body: emptyBody,
    query: metricsQuery,
    params: z.object({ id: objectId }),
  }),
  createInfluencer: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(120),
      slug: z.string().trim().max(64).optional(),
      status: influencerStatus.optional(),
      notes: z.string().max(2000).optional(),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  updateInfluencer: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      slug: z.string().trim().max(64).optional(),
      status: influencerStatus.optional(),
      notes: z.string().max(2000).optional(),
    }),
    query: emptyQuery,
    params: z.object({ id: objectId }),
  }),
  createCampaign: z.object({
    body: z.object({
      name: z.string().trim().min(1, "Campaign name is required").max(160),
      slug: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
      type: campaignType,
      status: campaignStatus.optional(),
      startsAt: optionalDate,
      endsAt: optionalDate,
      influencerId: optionalObjectId,
      notes: z.preprocess(emptyToUndefined, z.string().max(4000).optional()),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  updateCampaign: z.object({
    body: z.object({
      name: z.string().trim().min(1).max(160).optional(),
      slug: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
      type: campaignType.optional(),
      status: campaignStatus.optional(),
      startsAt: optionalDate,
      endsAt: optionalDate,
      influencerId: optionalObjectId,
      notes: z.preprocess(emptyToUndefined, z.string().max(4000).optional()),
    }),
    query: emptyQuery,
    params: z.object({ id: objectId }),
  }),
  createCoupon: z.object({
    body: z.object({
      code: z.string().trim().min(1).max(32),
      campaignId: objectId,
      discountType: discountType,
      discountValue: z.coerce.number().positive(),
      startsAt: optionalDate,
      expiresAt: optionalDate,
      status: couponStatus.optional(),
      maxRedemptions: z.coerce.number().int().min(1).optional(),
      maxPerUser: z.coerce.number().int().min(1).optional(),
      minAmount: z.coerce.number().min(0).optional(),
      applicablePlanTypes: z.array(planType).optional(),
      firstTimePayerOnly: z.boolean().optional(),
      excludeActiveSubscribers: z.boolean().optional(),
      newPurchaseOnly: z.boolean().optional(),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  updateCoupon: z.object({
    body: z.object({
      code: z.string().trim().min(1).max(32).optional(),
      campaignId: optionalObjectId,
      discountType: discountType.optional(),
      discountValue: z.coerce.number().positive().optional(),
      startsAt: optionalDate,
      expiresAt: optionalDate,
      status: couponStatus.optional(),
      maxRedemptions: z.coerce.number().int().min(1).nullable().optional(),
      maxPerUser: z.coerce.number().int().min(1).optional(),
      minAmount: z.coerce.number().min(0).optional(),
      applicablePlanTypes: z.array(planType).optional(),
      firstTimePayerOnly: z.boolean().optional(),
      excludeActiveSubscribers: z.boolean().optional(),
      newPurchaseOnly: z.boolean().optional(),
    }),
    query: emptyQuery,
    params: z.object({ id: objectId }),
  }),
  listCoupons: z.object({
    body: emptyBody,
    query: z.object({ campaignId: optionalObjectId }).passthrough(),
    params: emptyQuery,
  }),
};

module.exports = { userPromotionSchemas, adminPromotionSchemas };
