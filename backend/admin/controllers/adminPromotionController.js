"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const admin = require("../../services/promotionAdmin.service");

exports.overview = asyncHandler(async (req, res) => {
  res.json(await admin.overview(req.query));
});

exports.listCampaigns = asyncHandler(async (req, res) => {
  res.json({ campaigns: await admin.listCampaigns() });
});

exports.createCampaign = asyncHandler(async (req, res) => {
  const campaign = await admin.createCampaign(req.body, req.user._id);
  res.status(201).json({ campaign });
});

exports.updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await admin.updateCampaign(req.params.id, req.body);
  res.json({ campaign });
});

exports.getCampaignMetrics = asyncHandler(async (req, res) => {
  res.json(await admin.campaignMetrics(req.params.id, req.query));
});

exports.listCoupons = asyncHandler(async (req, res) => {
  res.json({ coupons: await admin.listCoupons(req.query) });
});

exports.createCoupon = asyncHandler(async (req, res) => {
  const coupon = await admin.createCoupon(req.body, req.user._id);
  res.status(201).json({ coupon });
});

exports.updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await admin.updateCoupon(req.params.id, req.body);
  res.json({ coupon });
});

exports.listInfluencers = asyncHandler(async (req, res) => {
  res.json({ influencers: await admin.listInfluencers() });
});

exports.createInfluencer = asyncHandler(async (req, res) => {
  const influencer = await admin.createInfluencer(req.body, req.user._id);
  res.status(201).json({ influencer });
});

exports.updateInfluencer = asyncHandler(async (req, res) => {
  const influencer = await admin.updateInfluencer(req.params.id, req.body);
  res.json({ influencer });
});

exports.getInfluencerMetrics = asyncHandler(async (req, res) => {
  res.json(await admin.influencerMetrics(req.params.id, req.query));
});

exports.listRedemptions = asyncHandler(async (req, res) => {
  res.json(await admin.listRedemptions(req.query));
});
