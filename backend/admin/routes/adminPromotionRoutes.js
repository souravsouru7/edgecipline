"use strict";

const express = require("express");
const router = express.Router();
const { adminAuth } = require("../../middleware/adminAuth");
const { validateRequest } = require("../../middleware/validateRequest");
const { adminFinancialRateLimiter } = require("../../middleware/rateLimiter");
const { adminPromotionSchemas } = require("../../validation/promotionSchemas");
const ctrl = require("../controllers/adminPromotionController");

router.get("/overview", adminAuth, validateRequest(adminPromotionSchemas.overview), ctrl.overview);
router.get("/redemptions", adminAuth, validateRequest(adminPromotionSchemas.list), ctrl.listRedemptions);

router.get("/campaigns", adminAuth, ctrl.listCampaigns);
router.post(
  "/campaigns",
  adminAuth,
  adminFinancialRateLimiter,
  validateRequest(adminPromotionSchemas.createCampaign),
  ctrl.createCampaign
);
router.patch(
  "/campaigns/:id",
  adminAuth,
  adminFinancialRateLimiter,
  validateRequest(adminPromotionSchemas.updateCampaign),
  ctrl.updateCampaign
);
router.get(
  "/campaigns/:id",
  adminAuth,
  validateRequest(adminPromotionSchemas.idParams),
  ctrl.getCampaignMetrics
);

router.get("/coupons", adminAuth, validateRequest(adminPromotionSchemas.listCoupons), ctrl.listCoupons);
router.post(
  "/coupons",
  adminAuth,
  adminFinancialRateLimiter,
  validateRequest(adminPromotionSchemas.createCoupon),
  ctrl.createCoupon
);
router.patch(
  "/coupons/:id",
  adminAuth,
  adminFinancialRateLimiter,
  validateRequest(adminPromotionSchemas.updateCoupon),
  ctrl.updateCoupon
);

router.get("/influencers", adminAuth, ctrl.listInfluencers);
router.post(
  "/influencers",
  adminAuth,
  adminFinancialRateLimiter,
  validateRequest(adminPromotionSchemas.createInfluencer),
  ctrl.createInfluencer
);
router.patch(
  "/influencers/:id",
  adminAuth,
  adminFinancialRateLimiter,
  validateRequest(adminPromotionSchemas.updateInfluencer),
  ctrl.updateInfluencer
);
router.get(
  "/influencers/:id",
  adminAuth,
  validateRequest(adminPromotionSchemas.idParams),
  ctrl.getInfluencerMetrics
);

module.exports = router;
